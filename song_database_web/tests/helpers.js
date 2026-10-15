import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function database({demo=false}={}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_wishlist.sql',import.meta.url),'utf8'));
  if(demo) sqlite.exec(readFileSync(new URL('../migrations/0002_demo.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0005_band_spaces.sql',import.meta.url),'utf8'));
  const prepare = sql => {
    const stmt = sqlite.prepare(sql);
    function bind(...args) {
      return {
        execute() { return {success:true,results:stmt.all(...args).map(r=>({...r}))}; },
        async first() { return stmt.get(...args) || null; },
        async all() { return this.execute(); },
      };
    }
    return {...bind(),bind};
  };
  return {sqlite,prepare,async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result=statements.map(s=>s.execute()); sqlite.exec('COMMIT'); return result; }
    catch(e) { sqlite.exec('ROLLBACK'); throw e; }
  }};
}
export const song = (name='测试曲目') => ({name,version:'原版',languages:['仅日语'],status:'可演'});
export const event = (song_id,extra={}) => ({name:'测试演出',date:'2026-09-01',organizer:'测试主办',venue:'测试场地',languages:['仅日语'],status:'计划中',items:[{song_id,note:'返场'}],...extra});
