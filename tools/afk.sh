#!/bin/sh
# Idle test: the bot plays properly until T seconds, then lets go of the controls. Prints how long each class survives standing still
# (capped at 120 s). Usage: tools/afk.sh "<T seconds list>" "<extra flags>"
TIMES="${1:-120 300 480 600 720}"; FLAGS="$2"
for T in $TIMES; do
  for c in vanguard pyromancer ranger reaper; do
    ( node "$(dirname "$0")/playtest.js" $c 99 2 --quiet --afk=$T $FLAGS 2>&1 | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        const T=+process.argv[1]; const re=/\{[\s\S]*?\n\}/g; let m; const out=[];
        while((m=re.exec(s))){ try{ const j=JSON.parse(m[0]); out.push(j.time<T? "died-before" : (j.dead? (j.time-T)+"s" : "SURVIVED")); }catch(e){} }
        console.log("idle from "+String(T).padStart(4)+"s  "+process.argv[2].padEnd(10)+" "+out.join("  "));
        if(/ERRORS/.test(s)) console.log(s.slice(s.indexOf("ERRORS")));
      })' $T $c ) &
  done
  wait
done
