const fs=require('fs');
eval(fs.readFileSync(require('path').join(__dirname,'logic.js'),'utf8')+`
const ex=(t,n,w,p,rel,lag,dur)=>({type:t,name:n,who:w||'',pred:p||'',rel:rel||'EA',lag:lag??'',fixed:'',dur:dur??''});
const rows=[ex('vorgang','Planung'),ex('untervorgang','Bestandsaufnahme','A','','EA','',3),ex('untervorgang','Konzept','B',2,'EA','',5),ex('meilenstein','Freigabe','A',3),
 ex('vorgang','Umsetzung'),ex('untervorgang','AP1','B',4,'EA','',8),ex('untervorgang','AP2','C',6,'EA','',7),ex('untervorgang','Abstimmung','A',6,'AA',2,3),
 ex('meilenstein','Zwischenabnahme','A',7),ex('vorgang','Abschluss'),ex('untervorgang','Doku','C',9,'EA','',5),ex('untervorgang','Uebergabe','B',11,'EE','',2),ex('meilenstein','Ende','A',12)];
rows.forEach((r,i)=>r.id=i+1);
const st={start:'2026-10-12',mode:'work',holidays:[],rows};
const s=schedule(st);
rows.forEach((r,i)=>console.log(s.psp[i].padEnd(4),r.name.padEnd(18),fmt(s.out[i].S),'->',fmt(s.out[i].E),s.out[i].err||''));
// Zirkel
rows[1].pred=1; const s2=schedule(st); console.log('cycle child err:',s2.out[1].err, 'parent err:',s2.out[0].err);
rows[1].pred='';
// Kalendertage
st.mode='cal'; const s3=schedule(st); console.log('cal AP2:',fmt(s3.out[6].S),fmt(s3.out[6].E),'Ende',fmt(s3.out[12].S));
console.log(fmtLong(parseISO('2027-03-26')), isoWeek(parseISO('2026-10-12')), isoWeek(parseISO('2027-01-01')), parseHolidayLine('26.03.2027 Karfreitag'), parseHolidayLine('2027-02-30 x'));
`);
