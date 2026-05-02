'use strict';
// §16 colour meaning system. Stamped by historical/event modules; rendered as text tags so Discord messages remain readable.

const COLOUR = Object.freeze({
  GREEN:  { name: 'GREEN',  meaning: 'supportive / positive historical reinforcement' },
  RED:    { name: 'RED',    meaning: 'adverse / danger / invalidation-aligned' },
  AMBER:  { name: 'AMBER',  meaning: 'mixed / developing' },
  WHITE:  { name: 'WHITE',  meaning: 'neutral' },
  BLUE:   { name: 'BLUE',   meaning: 'context' }
});

function tag(colour, label) {
  return `\`[${colour.name}]\` ${label}`;
}

function legendLine() {
  return '*Colour key:* GREEN supportive · RED adverse · AMBER mixed · WHITE neutral · BLUE context';
}

module.exports = { COLOUR, tag, legendLine };
