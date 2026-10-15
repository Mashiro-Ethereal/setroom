import { zipSync, strToU8 } from './vendor/fflate.js';
import { styles } from './excel-styles.js';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const safeName = value => value.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,160) || '歌单';
const today = () => new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const width = value => [...String(value)].reduce((n,c)=>n+(c.codePointAt(0)>0xff?2:1),0);
function column(n) { let v=''; while(n) { n--; v=String.fromCharCode(65+n%26)+v; n=Math.floor(n/26); } return v; }
function cell(ref,value,style=0) {
  if (value instanceof Date) return `<c r="${ref}" s="${style===3?5:4}"><v>${Math.round((value-Date.UTC(1899,11,30))/86400000)}</v></c>`;
  if (typeof value === 'number') return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
function worksheet({title,subtitle,headers,rows,widths,filterable=true}) {
  const end=column(headers.length), subtitleHeight=Math.max(24,Math.ceil(width(subtitle)/(widths.reduce((a,b)=>a+b,0)-2))*16+8);
  const pane=filterable?'<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/>':'';
  let result=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${end}${Math.max(5+rows.length,5)}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>`;
  result+=widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
  result+=`</cols><sheetData><row r="2" ht="28" customHeight="1">${cell('A2',title,2)}</row><row r="3" ht="${subtitleHeight}" customHeight="1">${cell('A3',subtitle)}</row><row r="5" ht="28" customHeight="1">${headers.map((h,i)=>cell(`${column(i+1)}5`,h,1)).join('')}</row>`;
  result+=rows.map((row,index)=>{
    const n=index+6;
    const lines=Math.max(1,...row.map((v,i)=>String(v instanceof Date?v.toISOString().slice(0,10):v).split('\n').reduce((sum,part)=>sum+Math.max(1,Math.ceil(width(part)/Math.max(1,widths[i]-2))),0)));
    const cells=row.map((value,i)=>cell(`${column(i+1)}${n}`,value,i===0 && headers[0]==='序号'?(n%2===0?7:6):(n%2===0?3:0))).join('');
    return `<row r="${n}" ht="${Math.min(409,Math.max(27,lines*16+8))}" customHeight="1">${cells}</row>`;
  }).join('');
  result+='</sheetData>';
  if(filterable&&rows.length) result+=`<autoFilter ref="A5:${end}${5+rows.length}"/>`;
  return result+`<mergeCells count="2"><mergeCell ref="A2:${end}2"/><mergeCell ref="A3:${end}3"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}
function workbook(sheets) {
  const files={
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>',
    '_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>`+sheets.map(([name],i)=>`<sheet name="${xml(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets><definedNames>'+sheets.map(([name],i)=>`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xml(name)}'!$5:$5</definedName>`).join('')+'</definedNames></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${REL}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':styles,
  };
  sheets.forEach(([,layout],i)=>files[`xl/worksheets/sheet${i+1}.xml`]=worksheet(layout));
  return zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])),{level:6});
}
export function makeExcel(data) {
  if(data.kind==='wishlist') {
    const label=id=>data.members.find(m=>m.id===id)?.label || id;
    const rows=data.songs.map(w=>[w.name,w.version,w.languages.join('、'),typeof w.supporters==='string'?w.initiator:label(w.initiator),typeof w.supporters==='string'?w.supporters:w.supporters.map(label).join('、')]);
    return {name:`乐队愿望单_${today()}.xlsx`,bytes:workbook([['愿望单',{title:'乐队愿望单',subtitle:`${data.scope} · 共 ${rows.length} 首 · 导出日期 ${today()}`,headers:['曲目名称','版本','语言','发起人','我也想排'],rows,widths:[38,30,22,20,48]}]])};
  }
  if(data.kind==='songs') {
    const rows=data.songs.map(s=>[s.name,s.version,s.languages.join('、'),s.status]);
    return {name:`乐队曲库_${today()}.xlsx`,bytes:workbook([['曲库',{title:'乐队曲库',subtitle:`${data.scope} · 共 ${rows.length} 首 · 导出日期 ${today()}`,headers:['曲目名称','版本','语言','状态'],rows,widths:[38,32,26,14]}]])};
  }
  const e=data.event, archived=e.status==='已完成';
  const rows=e.items.map((item,i)=>[i+1,item.song.name,item.song.version,item.song.languages.join('、'),item.note,...(archived?[]:[item.current_status])]);
  return {name:safeName(`${e.date}_${e.name}_歌单`)+'.xlsx',bytes:workbook([
    ['演出信息',{title:'演出信息',subtitle:archived?'实际演出记录':'演出安排',headers:['项目','内容'],rows:[['演出日期',new Date(`${e.date}T00:00:00Z`)],['演出名字',e.name],['主办方',e.organizer],['地点',e.venue],['语言',e.languages.join('、')],['状态',e.status]],widths:[22,80],filterable:false}],
    ['演出歌单',{title:archived?'实际演出歌单':'演出歌单',subtitle:`${e.date} · ${e.name}`,headers:['序号','曲目名称','版本','语言','本场备注',...(archived?[]:['曲目状态'])],rows,widths:[9,32,26,22,48,...(archived?[]:[14])]}],
  ])};
}
export function downloadExcel(data) {
  const {name,bytes}=makeExcel(data), blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob), anchor=document.createElement('a');
  anchor.href=url; anchor.download=name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
