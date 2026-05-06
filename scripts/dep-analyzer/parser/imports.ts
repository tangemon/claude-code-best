import { resolve, dirname, relative } from 'path';
import type { ImportInfo, ExportInfo, SymbolType } from '../types.js';
import type { TsconfigResult } from './tsconfig.js';
import { resolveAlias, normalizeExtension } from './tsconfig.js';

export function extractImports(filePath: string, content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  
  try {
    // First, match single-line imports (from on same line as import keyword)
    // This prevents matching across comment lines that contain 'import' keyword
    const singleLineRegex = /import\s+(?:type\s+)?([^\n]*?)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = singleLineRegex.exec(content)) !== null) {
      const importClause = match[1].trim();
      const importPath = match[2];
      
      const names: string[] = [];
      
      // 提取花括号内的内容，支持 type { A, B } 或 { A, type B } 格式
      const braceMatch = importClause.match(/^\{([\s\S]*)\}$/) || importClause.match(/^\s*type\s+\{([\s\S]*)\}\s*$/);
      if (braceMatch) {
        const namedImports = braceMatch[1];
        const importNames = namedImports.split(',').map(n => {
          const trimmed = n.trim();
          const asIndex = trimmed.indexOf(' as ');
          let name = asIndex > -1 ? trimmed.slice(0, asIndex).trim() : trimmed;
          if (name.startsWith('type ')) {
            name = name.slice(5);
          }
          return name;
        }).filter(n => n);
        names.push(...importNames);
      } else if (importClause === '' || importClause === 'type') {
        // default import or type-only default
      } else if (!importClause.includes('from')) {
        // namespace import: import * as X
        if (importClause.startsWith('*')) {
          names.push('*');
        } else {
          names.push(importClause.split(',').map(n => n.trim()).filter(n => n)[0] || '');
        }
      }
      
      imports.push({
        path: importPath,
        names: names.filter(n => n),
        isDynamic: false,
        isReExport: false,
      });
    }
    
    // Then, match multi-line imports where 'from' is on a different line than 'import'
    // Use a more permissive regex that allows 'from' to appear after the closing brace
    const multiLineRegex = /import\s+\{[\s\S]*?\}\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = multiLineRegex.exec(content)) !== null) {
      const importPath = match[1];
      
      // Skip if this import was already matched by the single-line regex
      // (check if the path and a sample name already exist in imports)
      const alreadyMatched = imports.some(i => i.path === importPath);
      if (alreadyMatched) continue;
      
      // Extract names from the multi-line import
      const fullMatch = match[0];
      const braceContentMatch = fullMatch.match(/import\s+\{([\s\S]*?)\}/);
      if (!braceContentMatch) continue;
      
      const namedImports = braceContentMatch[1];
      const names = namedImports.split(',').map(n => {
        const trimmed = n.trim();
        const asIndex = trimmed.indexOf(' as ');
        let name = asIndex > -1 ? trimmed.slice(0, asIndex).trim() : trimmed;
        if (name.startsWith('type ')) {
          name = name.slice(5);
        }
        return name;
      }).filter(n => n);
      
      imports.push({
        path: importPath,
        names,
        isDynamic: false,
        isReExport: false,
      });
    }
    
    // 动态 import 带解构: const { a, b } = await import('./path')
    const dynamicDestructuredRegex = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:await\s+)?import\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = dynamicDestructuredRegex.exec(content)) !== null) {
      const names = match[1].split(',').map(n => {
        const trimmed = n.trim();
        const asIndex = trimmed.indexOf(' as ');
        return asIndex > -1 ? trimmed.slice(0, asIndex).trim() : trimmed;
      }).filter(n => n && !n.startsWith('...'));
      
      imports.push({
        path: match[2],
        names,
        isDynamic: true,
        isReExport: false,
      });
    }
    
    // 动态 import 不带解构: const mod = await import('./path')
    // 使用负向前瞻确保不匹配 require()
    const dynamicRegex = /(?<!\w)import\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = dynamicRegex.exec(content)) !== null) {
      // 跳过 require() 调用
      const beforeMatch = content.slice(Math.max(0, match.index - 10), match.index);
      if (beforeMatch.includes('require')) continue;
      
      // 跳过 typeof import() 形式（类型断言）
      const afterMatch = content.slice(match.index, match.index + 20);
      if (afterMatch.includes('typeof')) continue;
      
      // 检查这行是否已经有了解构匹配（避免重复）
      const lineStart = match.index;
      const lineEnd = content.indexOf('\n', lineStart);
      const lineContent = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
      if (!/\{[^}]+\}\s*=\s*(?:await\s+)?import\s*\(/.test(lineContent)) {
        imports.push({
          path: match[1],
          names: [],
          isDynamic: true,
          isReExport: false,
        });
      }
    }
    
    // CommonJS require 带解构: const { a, b } = require('./path')
    const requireDestructuredRegex = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = requireDestructuredRegex.exec(content)) !== null) {
      const names = match[1].split(',').map(n => {
        const trimmed = n.trim();
        const asIndex = trimmed.indexOf(' as ');
        return asIndex > -1 ? trimmed.slice(0, asIndex).trim() : trimmed;
      }).filter(n => n && !n.startsWith('...'));
      
      imports.push({
        path: match[2],
        names,
        isDynamic: false,
        isReExport: false,
      });
    }
    
    // CommonJS require 不带解构: const mod = require('./path')
    // 同时分析对象属性访问: mod.symbolName()
    // 支持三元运算符形式: const mod = cond ? require('./path') : null
    
    // 1. 收集所有 const/let/var 声明及其位置
    const varDeclarations: Array<{ name: string; endPos: number }> = [];
    const varDeclRegex = /(?:const|let|var)\s+(\w+)\s*=/g;
    while ((match = varDeclRegex.exec(content)) !== null) {
      varDeclarations.push({ name: match[1], endPos: match.index + match[0].length });
    }
    
    // 2. 收集所有 require() 调用及其位置
    const requireCalls: Array<{ path: string; startPos: number }> = [];
    const requirePathRegex = /require\s*\(['"]([^'"]+)['"]\)/g;
    while ((match = requirePathRegex.exec(content)) !== null) {
      requireCalls.push({ path: match[1], startPos: match.index });
    }
    
    // 3. 关联变量声明和 require() 调用（通过位置）
    const requireVars = new Map<string, { path: string; names: Set<string> }>();
    for (const varDecl of varDeclarations) {
      for (const reqCall of requireCalls) {
        if (reqCall.startPos >= varDecl.endPos && reqCall.startPos < varDecl.endPos + 200) {
          if (!requireVars.has(varDecl.name)) {
            requireVars.set(varDecl.name, { path: reqCall.path, names: new Set() });
            imports.push({
              path: reqCall.path,
              names: [],
              isDynamic: false,
              isReExport: false,
            });
          }
        }
      }
    }
    
    // 分析 require() 返回对象的属性访问: kairosGate.isKairosEnabled()
    if (requireVars.size > 0) {
      const varNames = Array.from(requireVars.keys()).join('|');
      const propertyAccessRegex = new RegExp(`(${varNames})\\.(\\w+)`, 'g');
      while ((match = propertyAccessRegex.exec(content)) !== null) {
        const varName = match[1];
        const propName = match[2];
        const entry = requireVars.get(varName);
        if (entry) {
          entry.names.add(propName);
        }
      }
      
      // 更新 imports 中的 names
      for (const importInfo of imports) {
        for (const [varName, entry] of requireVars) {
          if (entry.path === importInfo.path && entry.names.size > 0) {
            importInfo.names.push(...entry.names);
          }
        }
      }
    }
    
    const reExportRegex = /export\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = reExportRegex.exec(content)) !== null) {
      const namedImports = match[1];
      const importPath = match[2];
      const names = namedImports.split(',').map(n => {
        const trimmed = n.trim();
        const asIndex = trimmed.indexOf(' as ');
        let name = asIndex > -1 ? trimmed.slice(0, asIndex).trim() : trimmed;
        if (name.startsWith('type ')) {
          name = name.slice(5);
        }
        return name;
      }).filter(n => n);
      
      imports.push({
        path: importPath,
        names,
        isDynamic: false,
        isReExport: true,
      });
    }
  } catch {
    // Ignore regex errors for malformed content
  }
  
  return imports;
}

export function extractExports(content: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  
  try {
    const namedExportRegex = /export\s+\{([\s\S]*?)\}/g;
    let match;
    while ((match = namedExportRegex.exec(content)) !== null) {
      const names = match[1].split(',').map(n => {
        const trimmed = n.trim().split(' as ')[0].trim();
        if (trimmed.startsWith('type ')) {
          return trimmed.slice(5);
        }
        return trimmed;
      });
      for (const name of names) {
        if (name) {
          const lineNum = content.slice(0, match.index).split('\n').length;
          exports.push({ name, type: 'export', line: lineNum });
        }
      }
    }
    
    const defaultExportRegex = /export\s+default\s+(\w+)/g;
    while ((match = defaultExportRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      exports.push({ name: match[1], type: 'default', line: lineNum });
    }
    
    const patterns: Array<{ regex: RegExp; type: string }> = [
      { regex: /export\s+function\s+(\w+)/g, type: 'function' },
      { regex: /export\s+const\s+(\w+)/g, type: 'const' },
      { regex: /export\s+class\s+(\w+)/g, type: 'class' },
      { regex: /export\s+interface\s+(\w+)/g, type: 'interface' },
      { regex: /export\s+type\s+(\w+)/g, type: 'type' },
      { regex: /export\s+enum\s+(\w+)/g, type: 'enum' },
      { regex: /export\s+async\s+function\s+(\w+)/g, type: 'function' },
      { regex: /export\s+declare\s+(?:function|class|interface|type|enum)\s+(\w+)/g, type: 'unknown' },
    ];
    
    for (const { regex, type } of patterns) {
      while ((match = regex.exec(content)) !== null) {
        const name = match[1];
        const lineNum = content.slice(0, match.index).split('\n').length;
        exports.push({ name, type, line: lineNum });
      }
    }
  } catch {
    // Ignore regex errors for malformed content
  }
  
  return exports;
}

export function extractSymbols(content: string): ExportInfo[] {
  const symbols: ExportInfo[] = [];
  
  try {
    const functionRegex = /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      symbols.push({ name: match[1], type: 'function', line: lineNum });
    }
    
    const classRegex = /(?:^|\n)(?:export\s+)?class\s+(\w+)(?:\s+extends|\s+implements|$)/g;
    while ((match = classRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      symbols.push({ name: match[1], type: 'class', line: lineNum });
    }
    
    const interfaceRegex = /(?:^|\n)(?:export\s+)?interface\s+(\w+)/g;
    while ((match = interfaceRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      symbols.push({ name: match[1], type: 'interface', line: lineNum });
    }
    
    const typeRegex = /(?:^|\n)(?:export\s+)?type\s+(\w+)/g;
    while ((match = typeRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      symbols.push({ name: match[1], type: 'type', line: lineNum });
    }
    
    const constRegex = /(?:^|\n)(?:export\s+)?const\s+(\w+)\s*=/g;
    while ((match = constRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      symbols.push({ name: match[1], type: 'const', line: lineNum });
    }
    
    const enumRegex = /(?:^|\n)(?:export\s+)?enum\s+(\w+)/g;
    while ((match = enumRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      symbols.push({ name: match[1], type: 'enum', line: lineNum });
    }
  } catch {
    // Ignore regex errors for malformed content
  }
  
  return symbols;
}

export function resolveImportPath(
  importPath: string,
  fromFile: string,
  tsconfig: TsconfigResult,
  projectRoot: string
): string | null {
  if (importPath.startsWith('.')) {
    const dir = dirname(fromFile);
    const resolved = normalizeExtension(resolve(dir, importPath));
    return resolved.startsWith(projectRoot) ? resolved : null;
  }
  
  if (importPath.startsWith('@claude-code-best/')) {
    const alias = '@claude-code-best/' + importPath.split('/').slice(2).join('/');
    return resolveAlias(alias, tsconfig);
  }
  
  if (importPath.startsWith('src/')) {
    return resolveAlias(importPath, tsconfig);
  }
  
  if (importPath.startsWith('bun:') || importPath.startsWith('node:')) {
    return null;
  }
  
  return resolveAlias(importPath, tsconfig);
}

export function getRelativePath(from: string, to: string, projectRoot: string): string {
  const rel = relative(projectRoot, to);
  return rel.replace(/\\/g, '/');
}
