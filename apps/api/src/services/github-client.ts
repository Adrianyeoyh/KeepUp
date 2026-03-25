import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';
import { config } from '../config.js';
import { integrationService } from './integration.js';
import { logger } from '../logger.js';

/**
 * Get an authenticated Octokit client capable of acting on a repository.
 *
 * Auth strategy hierarchy:
 *   1. GitHub App installation token (preferred — per-repo fine-grained scope)
 *   2. Personal / org token from integrations table (fallback)
 *
 * Returns null if no valid credentials are available.
 */
export async function getOctokitForRepo(
  companyId: string,
  repoFullName: string,
): Promise<Octokit | null> {
  // Strategy 1: GitHub App install
  if (config.GITHUB_APP_ID && config.GITHUB_PRIVATE_KEY_PATH) {
    try {
      const privateKey = fs.readFileSync(config.GITHUB_PRIVATE_KEY_PATH, 'utf8');
      const appOctokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.GITHUB_APP_ID,
          privateKey,
        },
      });

      // Find the installation for this repo
      const [owner, repo] = repoFullName.split('/');
      const { data: installation } = await appOctokit.apps.getRepoInstallation({ owner, repo });

      return new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.GITHUB_APP_ID,
          privateKey,
          installationId: installation.id,
        },
      });
    } catch (err) {
      logger.debug({ err, repoFullName }, 'GitHub App auth not available for repo — trying token fallback');
    }
  }

  // Strategy 2: Token from integrations table
  const integration = await integrationService.getActive(companyId, 'github');
  const token =
    (integration?.token_data as Record<string, string> | null)?.access_token ||
    (integration?.token_data as Record<string, string> | null)?.token;

  if (token) {
    return new Octokit({ auth: token });
  }

  logger.warn({ companyId, repoFullName }, 'No GitHub credentials available');
  return null;
}
