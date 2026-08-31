import { describe, expect, it, vi } from 'vitest';
import {
  commandConfig,
  registerCommands,
} from '../scripts/register-discord-commands';

const config = {
  botToken: 'bot-token-secret',
  applicationId: 'application/id',
  guildId: 'guild/id',
};

describe('Discord guild command registration', () => {
  it('requires all local registration credentials', () => {
    expect(commandConfig({})).toBeNull();
    expect(commandConfig({
      DISCORD_BOT_TOKEN: config.botToken,
      DISCORD_APPLICATION_ID: config.applicationId,
      DISCORD_COMMAND_GUILD_ID: config.guildId,
    })).toEqual(config);
  });

  it('upserts only the alive command without bulk-overwriting the guild', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));

    await registerCommands(config, fetchMock as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://discord.com/api/v10/applications/application%2Fid/guilds/guild%2Fid/commands',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bot bot-token-secret',
      'Content-Type': 'application/json; charset=utf-8',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'alive',
      description: 'Vaultwardenの公開経路を確認します',
      type: 1,
      default_member_permissions: '0',
    });
  });

  it('propagates a non-successful Discord response without exposing the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));

    await expect(registerCommands(config, fetchMock as typeof fetch)).rejects.toThrow(
      'Discord command registration failed: 403',
    );
    await expect(registerCommands(config, fetchMock as typeof fetch)).rejects.not.toThrow(
      config.botToken,
    );
  });
});
