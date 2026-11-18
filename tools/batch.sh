#!/bin/sh
# run several playtests in parallel and print one-line summaries: tools/batch.sh "<extra flags>" [minutes]
FLAGS="$1"; MIN="${2:-14}"
for c in vanguard pyromancer ranger reaper; do
  ( node "$(dirname "$0")/playtest.js" $c $MIN 2 --quiet $FLAGS 2>&1 | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const re=/\{[\s\S]*?\n\}/g; let m;
      while((m=re.exec(s))){ try{ const j=JSON.parse(m[0]); console.log([j.cls.padEnd(10), (j.dead?"DEAD":"alive")+"@"+j.time, "L"+j.level, "kills "+j.kills, "bosses "+j.bosses, j.won?"WON":"", "taken "+j.taken, "hp "+j.hp, "| "+j.bossLog, "| "+j.top.slice(0,4).join(", ")].join("  ")); }catch(e){} }
      if(/ERRORS/.test(s)) console.log(s.slice(s.indexOf("ERRORS")));
    })' ) &
done
wait
