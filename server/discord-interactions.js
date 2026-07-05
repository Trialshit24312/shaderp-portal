import { MessageFlags } from 'discord.js';

/** Normalize payload: use MessageFlags.Ephemeral instead of deprecated ephemeral option. */
export function withEphemeral(payload = {}, ephemeral = true) {
  if (payload == null || typeof payload !== 'object') return payload;
  const { ephemeral: _ignored, flags, ...rest } = payload;
  if (ephemeral === false) return rest;
  return { ...rest, flags: (flags ?? 0) | MessageFlags.Ephemeral };
}

export async function deferEphemeral(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply(withEphemeral({}));
}

/** Reply or edit (after defer) without double-acknowledging the interaction. */
export async function replyEphemeral(interaction, payload, { ephemeral = true } = {}) {
  const data = withEphemeral(payload, ephemeral);
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(data);
  }
  return interaction.reply(data);
}

export async function safeInteractionReply(interaction, payload) {
  try {
    return await replyEphemeral(interaction, payload);
  } catch (err) {
    if (err?.code === 40060 || err?.code === 10062) return null;
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.followUp(withEphemeral(payload));
      }
    } catch (_) {
      /* expired */
    }
    return null;
  }
}
