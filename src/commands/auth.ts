import { Command } from "commander";
import { gql } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { SITE } from "../lib/operations.js";
import { output } from "../lib/output.js";
import {
  defaultProfile,
  hasAccount,
  listProfiles,
  readAccount,
  removeAccount,
  resolveProfile,
  saveAccount,
  setActiveProfile,
  usesEnvAccount,
} from "../lib/session.js";

type SiteData = {
  site: { id: string; name: string; subdomain: string; url: string };
  me: { id: string; email: string | null; firstName: string | null; lastName: string | null; hasAdminRole: boolean | null } | null;
};

/** Reads a line from the terminal without echoing it. */
async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new CliError(2, "No terminal to type the token", "Use --token-stdin");
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          reject(new CliError(2, "Cancelled"));
          return;
        }
        value = char === "\u007f" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
  });
}

export const authCommand = new Command("auth").description(
  "Thinkific API access token per profile (one profile per Thinkific site)",
);

authCommand
  .command("login")
  .description("Check an API access token and store it with its site (chmod 600)")
  .option("--profile <name>", "Profile name, one per Thinkific site (default: default)")
  .option("--token-stdin", "Read the token from stdin instead of prompting")
  .option("--expires <date>", "Expiry date chosen when the token was created (reminder only)")
  .option("--use", "Also make this profile the active one")
  .addHelpText(
    "after",
    `
Create the token in Thinkific: Settings > Code & analytics > API access tokens >
Add API access token (shown once). Needs a site owner or admin, and a plan with
API access (Grow or above).

Examples:
  esm-thinkific-cli auth login --profile encounter --expires 2027-02-01
  printf '%s' "$TOKEN" | esm-thinkific-cli auth login --token-stdin --profile encounter`,
  )
  .action(async (opts: { profile?: string; tokenStdin?: boolean; expires?: string; use?: boolean }) => {
    try {
      if (usesEnvAccount()) throw new CliError(2, "THINKIFIC_API_TOKEN is set in this shell and would be used instead", "unset THINKIFIC_API_TOKEN");
      const profile = resolveProfile(opts.profile);
      globalFlags.profile = profile;
      const token = (opts.tokenStdin ? await Bun.stdin.text() : await promptHidden("Thinkific API access token: ")).trim();
      if (!token) throw new CliError(2, "Empty token");

      // Save, check with a real call, and remove again if Thinkific refuses it.
      saveAccount({ token }, profile);
      let data: SiteData;
      try {
        data = await gql<SiteData>(SITE);
      } catch (err) {
        removeAccount(profile);
        throw err;
      }
      saveAccount(
        { token, site: data.site.name, subdomain: data.site.subdomain, url: data.site.url, expiresAt: opts.expires },
        profile,
      );
      if (opts.use || listProfiles().length === 1) setActiveProfile(profile);
      log.success(`Token saved for "${data.site.name}" (${data.site.url}), profile "${profile}"`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

authCommand
  .command("test")
  .alias("whoami")
  .description("Check the token and show the site it opens")
  .action(async () => {
    try {
      const { site, me } = await gql<SiteData>(SITE);
      const account = readAccount();
      output({
        profile: usesEnvAccount() ? "(THINKIFIC_API_TOKEN)" : resolveProfile(),
        site: site.name,
        subdomain: site.subdomain,
        url: site.url,
        user: me ? [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email : "(site token)",
        expiresAt: account.expiresAt ?? "-",
      });
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

authCommand
  .command("list")
  .alias("ls")
  .description("List stored tokens (* = active)")
  .action(() => {
    const profiles = listProfiles();
    if (profiles.length === 0 && !globalFlags.json) {
      log.warn("No token yet. Run: esm-thinkific-cli auth login");
      return;
    }
    output(profiles.map((p) => ({ active: p.active ? "*" : "", profile: p.name, site: p.site, subdomain: p.subdomain, expires: p.expiresAt })));
    if (!globalFlags.json && usesEnvAccount()) {
      log.warn("THINKIFIC_API_TOKEN is set in this shell and overrides every profile above.");
    }
  });

authCommand
  .command("use")
  .description("Switch the active profile")
  .argument("<profile>", "Profile name")
  .action((profile: string) => {
    try {
      if (!hasAccount(profile)) throw new CliError(2, `No token stored for profile "${profile}"`);
      setActiveProfile(profile);
      log.success(`Active profile is now "${profile}"`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

authCommand
  .command("show")
  .description("Show the selected profile (token masked)")
  .action(() => {
    try {
      const account = readAccount();
      output({
        profile: usesEnvAccount() ? "(THINKIFIC_API_TOKEN)" : resolveProfile(),
        default: defaultProfile(),
        site: account.site ?? "-",
        url: account.url ?? "-",
        token: `${account.token.slice(0, 4)}…${account.token.slice(-4)}`,
        expiresAt: account.expiresAt ?? "-",
      });
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

authCommand
  .command("logout")
  .description("Delete the stored token of the profile (revoke it in Thinkific too)")
  .action(() => {
    const profile = resolveProfile();
    removeAccount(profile);
    log.success(`Profile "${profile}" removed. Revoke the token in Thinkific: Settings > Code & analytics > API access tokens.`);
  });
