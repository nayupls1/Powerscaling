#!/usr/bin/env node
/* README check. The README quotes how many classes, skills, relics, feats and so on the game has; this loads the game
   and fails if any of those numbers has drifted from the data. Usage: node tools/counts.js */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.PS && PS.Game && PS.Render);
  const n = await page.evaluate(() => {
    const D = PS.Data;
    return {
      classes: D.CLASS_IDS.length, skills: PS.Skills.poolIds().length, relics: Object.keys(D.RELICS).length, feats: PS.Feats.LIST.length,
      pacts: Object.keys(D.PACTS).length, sets: D.RELIC_SETS.length, sigils: Object.keys(D.SIGILS).length, affixes: D.AFFIX_IDS.length,
      mutators: Object.keys(D.MUTATORS).length, enemies: Object.keys(PS.Enemies.DEFS).length, reactions: Object.keys(D.REACTIONS).length,
    };
  });
  await browser.close();
  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  const num = (k) => '(?:' + n[k] + '|' + (WORDS[n[k]] || n[k]) + ')';
  // each line: what the README must say, as a pattern built from the live count
  const want = [
    ['classes', new RegExp('\\*\\*' + num('classes') + ' classes\\*\\*', 'i')],
    ['skills', new RegExp('\\*\\*' + num('skills') + ' skills across six elements\\*\\*', 'i')],
    ['relics', new RegExp(num('relics') + ' relics from chests', 'i')],
    ['feats', new RegExp('\\*\\*Feats\\*\\* — ' + num('feats') + ' one-time goals', 'i')],
    ['pacts', new RegExp('three of ' + num('pacts') + ' pacts', 'i')],
    ['sets', new RegExp(num('sets') + ' named sets', 'i')],
    ['sigils', new RegExp('\\*\\*Sigils\\*\\* — ' + num('sigils') + ' perks', 'i')],
    ['affixes', new RegExp('one of ' + num('affixes') + ' affixes', 'i')],
    ['mutators', new RegExp('one of ' + num('mutators') + ' mutators', 'i')],
    ['enemies', new RegExp(num('enemies') + ' enemy types', 'i')],
    ['reactions', new RegExp(num('reactions') + ' reactions, one for every pair', 'i')],
  ];
  let bad = 0;
  for (const [k, re] of want) {
    if (!re.test(readme)) { bad++; console.log(`README is out of date: the game has ${n[k]} ${k}`); }
  }
  console.log(bad ? `\n${bad} count${bad > 1 ? 's' : ''} in the README no longer match the game` : 'the README\'s counts match the game');
  process.exitCode = bad ? 1 : 0;
})();
