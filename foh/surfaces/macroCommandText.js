'use strict';

function renderMacroCommandSurface(packet, opts) {
  const ctx = packet && packet.ctx ? packet.ctx : packet;
  const text = ctx && (ctx.content || ctx.text || ctx.discordText);
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('macro_command_surface_missing_text');
  }
  const maxChars = opts && Number.isFinite(opts.maxDiscordChunkChars) ? opts.maxDiscordChunkChars : null;
  if (!maxChars || text.length <= maxChars) return text;

  const marker = '🔵 SOURCE / DEGRADATION NOTE';
  const sourceIdx = text.lastIndexOf(marker);
  if (sourceIdx > 0) {
    const tailStart = Math.max(0, text.lastIndexOf('\n', sourceIdx - 1) + 1);
    const tail = text.slice(tailStart).trimStart();
    const headMax = Math.max(300, maxChars - tail.length - 8);
    if (headMax > 0 && tail.length < maxChars - 100) {
      return text.slice(0, headMax).trimEnd() + '\n…\n' + tail;
    }
  }
  return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

module.exports = { renderMacroCommandSurface };
