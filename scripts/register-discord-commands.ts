/**
 * Discord guild command登録CLI.
 * Worker実行時には不要なDISCORD_BOT_TOKENを、ローカルまたはCIのsecretからだけ読む。
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=... DISCORD_APPLICATION_ID=... DISCORD_COMMAND_GUILD_ID=... \
 *     bun run register-discord-commands
 */

const REQUIRED_VARS = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_APPLICATION_ID',
  'DISCORD_COMMAND_GUILD_ID',
] as const;

interface CommandConfig {
  botToken: string;
  applicationId: string;
  guildId: string;
}

export function commandConfig(env: Record<string, string | undefined>): CommandConfig | null {
  if (REQUIRED_VARS.some(name => !env[name])) {
    return null;
  }
  return {
    botToken: env.DISCORD_BOT_TOKEN!,
    applicationId: env.DISCORD_APPLICATION_ID!,
    guildId: env.DISCORD_COMMAND_GUILD_ID!,
  };
}

export async function registerCommands(
  config: CommandConfig,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchFn(
    `https://discord.com/api/v10/applications/${encodeURIComponent(config.applicationId)}/guilds/${encodeURIComponent(config.guildId)}/commands`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${config.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify([
        {
          name: 'alive',
          description: 'Vaultwardenの公開経路を確認します',
          type: 1,
          default_member_permissions: '0',
        },
      ]),
    },
  );

  if (!response.ok) {
    throw new Error(`Discord command registration failed: ${response.status}`);
  }
}

async function main(): Promise<void> {
  const config = commandConfig(process.env);
  if (!config) {
    console.error(`Missing required environment variables: ${REQUIRED_VARS.join(', ')}`);
    process.exit(1);
  }

  await registerCommands(config);
  console.log('Registered the /alive guild command.');
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
