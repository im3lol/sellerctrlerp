import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url);
const sharp=require('sharp');
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
// Extract the approved mark only; keep the existing artwork and transparency.
const region=await sharp(join(root,'public/brand/sellerctrl-3d-blue-logo.png')).extract({left:110,top:160,width:590,height:450}).png().toBuffer();
const mark=await sharp(region).trim({threshold:10}).png().toBuffer();
async function icon(size,white=false,margin=.05){
 const pad=Math.max(1,Math.round(size*margin));
 const background=white?'#ffffff':{r:0,g:0,b:0,alpha:0};
 return sharp(mark).resize(size-pad*2,size-pad*2,{fit:'contain',background}).extend({top:pad,bottom:pad,left:pad,right:pad,background}).png().toBuffer();
}
const sizes=[16,32,48,64],images=await Promise.all(sizes.map(size=>icon(size)));
// ICO entries use PNG payloads, supported by modern browsers and Windows.
const header=Buffer.alloc(6+images.length*16);
header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);
let offset=header.length;
for(let i=0;i<images.length;i++){
 const at=6+i*16;header[at]=sizes[i];header[at+1]=sizes[i];
 header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);
 header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;
}
await mkdir(join(root,'public/icons'),{recursive:true});
await writeFile(join(root,'app/favicon.ico'),Buffer.concat([header,...images]));
await writeFile(join(root,'app/icon.png'),images[3]);
await writeFile(join(root,'app/apple-icon.png'),await icon(180,true,.10));
await writeFile(join(root,'public/icons/icon-192.png'),await icon(192));
await writeFile(join(root,'public/icons/icon-512.png'),await icon(512));
// Keep the mark inside the central safe area for circular launcher crops.
await writeFile(join(root,'public/icons/icon-maskable-512.png'),await icon(512,true,.19));
console.log('Generated SellerCtrl favicon, browser, touch and launcher icons.');
