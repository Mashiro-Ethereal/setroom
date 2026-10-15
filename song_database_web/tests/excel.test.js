import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {makeExcel} from '../static/excel.js';
test('Excel stores formula-like names as literal text, freezes headers and has real date cells',()=>{
  const data={name:'=1+1',version:'<Acoustic>',languages:['中文','日语'],status:'可演'};
  const song=makeExcel({kind:'songs',songs:[data],scope:'筛选结果'});
  const files=unzipSync(song.bytes), sheet=strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet,/t="inlineStr"[^]*=1\+1/); assert.doesNotMatch(sheet,/<f>/);
  assert.match(sheet,/&lt;Acoustic&gt;/); assert.match(sheet,/ySplit="5"/);
  const archived=makeExcel({kind:'performance',event:{date:'2026-09-01',name:'测试/演出',organizer:'主办方',venue:'场地',languages:['中文'],status:'已完成',items:[{song:data,note:'返场',current_status:'取消'}]}});
  const eventFiles=unzipSync(archived.bytes);
  assert.equal(archived.name,'2026-09-01_测试_演出_歌单.xlsx');
  assert.match(strFromU8(eventFiles['xl/worksheets/sheet1.xml']),/<c r="B6" s="5"><v>\d+<\/v>/);
  assert.doesNotMatch(strFromU8(eventFiles['xl/worksheets/sheet2.xml']),/曲目状态/);
});
