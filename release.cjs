const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{deflateRawSync}=require('node:zlib');
const root=__dirname,pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8').replace(/^\uFEFF/,''));
const main=fs.readFileSync(path.join(root,'poor-mans-dj.js'));
if(!main.toString().startsWith(`/* POOR DJ ${pkg.version} | MIT */`))throw Error('Build and package versions differ');
if(main.length>150000)throw Error('Extension exceeds 150 KB');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
for(const key of ['name','description','preview','main','readme'])if(!manifest[key])throw Error('Missing manifest '+key);
const files=['poor-mans-dj.js','manifest.json','README.md','preview.png','LICENSE','CHANGELOG.md','PUBLISHING.md','VALIDATION.md','CONTRIBUTING.md','CODE_OF_CONDUCT.md','RELEASE_NOTES.md','assets/mark.svg'];
const dist=path.join(root,'dist'),stage=path.join(dist,'poor-dj-'+pkg.version);fs.mkdirSync(stage,{recursive:true});
for(const file of files){fs.mkdirSync(path.dirname(path.join(stage,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(stage,file));}
const zip=stage+'.zip';
// Small standard ZIP writer: Node built-ins only, independent of shell modules.
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
const records=[],central=[];let offset=0;
for(const file of files){
 const name=Buffer.from(file),data=fs.readFileSync(path.join(stage,file)),compressed=deflateRawSync(data),crc=crc32(data);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
 const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(8,10);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
 records.push(local,name,compressed);central.push(entry,name);offset+=local.length+name.length+compressed.length;
}
const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);fs.writeFileSync(zip,Buffer.concat([...records,index,end]));
const hash=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
fs.writeFileSync(zip+'.sha256',hash+'  '+path.basename(zip)+'\n');
console.log(`POOR DJ ${pkg.version}: ${main.length} bytes; package ${zip}; SHA-256 ${hash}`);
