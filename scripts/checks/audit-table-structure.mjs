/** Conservative JSX table audit. Dynamic/unknown widths are reported as unverified, not guessed. */
import fs from 'node:fs';import ts from 'typescript';
const paths=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())walk(p);else if(p.endsWith('.tsx'))paths.push(p);}}walk('app');walk('components');
const results=[];let total=0,checked=0,unknown=0;
const name=n=>ts.isJsxElement(n)?n.openingElement.tagName.getText():ts.isJsxSelfClosingElement(n)?n.tagName.getText():'';
function descendants(n,tag){const out=[];function visit(x){if(x!==n&&name(x)==='Table')return;if(name(x)===tag)out.push(x);ts.forEachChild(x,visit);}ts.forEachChild(n,visit);return out;}
function count(n,cell){if(!n)return null;if(name(n)===cell){const attrs=ts.isJsxElement(n)?n.openingElement.attributes:n.attributes;const span=attrs.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText()==='colSpan');if(!span)return[1,1];const v=span.initializer;if(v&&ts.isStringLiteral(v)&&/^\d+$/.test(v.text))return[+v.text,+v.text];if(v&&ts.isJsxExpression(v)&&v.expression&&ts.isNumericLiteral(v.expression))return[+v.expression.text,+v.expression.text];return null;}
 if(ts.isCallExpression(n)&&n.expression.getText().endsWith('.map'))return null;
 if(ts.isConditionalExpression(n)){const a=count(n.whenTrue,cell),b=count(n.whenFalse,cell);return a&&b?[Math.min(a[0],b[0]),Math.max(a[1],b[1])]:null;}
 if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken){const b=count(n.right,cell);return b?[0,b[1]]:null;}
 let a=0,b=0,ok=true;ts.forEachChild(n,c=>{const v=count(c,cell);if(!v)ok=false;else{a+=v[0];b+=v[1];}});return ok?[a,b]:null;
}
for(const file of paths){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);function visit(node){if(name(node)==='Table'){total++;const h=descendants(node,'TableHeader')[0];const row=h&&descendants(h,'TableRow')[0];const head=row&&count(row,'TableHead');const body=descendants(node,'TableBody')[0];let rows=body?descendants(body,'TableRow').map(n=>({n,range:count(n,'TableCell')})):[];
 for(const sortable of body?descendants(body,'SortableLineRows'):[]){const attr=(ts.isJsxElement(sortable)?sortable.openingElement.attributes:sortable.attributes).properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText()==='renderCells');const expr=attr?.initializer?.expression;const range=expr&&count(expr.body,'TableCell');rows.push({n:sortable,range:range?[range[0]+2,range[1]+2]:null});}
 for(const footer of descendants(node,'TableFooter')) for(const n of descendants(footer,'TableRow')) rows.push({n,range:count(n,'TableCell')});
 if(!head||!rows.length){unknown++;}else for(const r of rows){if(!r.range){unknown++;continue;}checked++;if(head[1]<r.range[0]||r.range[1]<head[0]){const pos=source.getLineAndCharacterOfPosition(r.n.pos);results.push({file,line:pos.line+1,header:head,body:r.range});}}
 }ts.forEachChild(node,visit);}visit(source);}
const report={files:paths.length,tables:total,checkedRows:checked,unverifiedDynamicCases:unknown,mismatches:results};fs.writeFileSync('.ops-data/system-audit-20261024/table-static.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
