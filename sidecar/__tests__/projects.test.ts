import { describe, expect, it } from 'vitest';
import { parseGithubRemote } from '../src/githubTypes.js';

describe('GitHub collaboration remote parsing', () => {
  it('derives owner and repository from HTTPS remotes', () => {
    expect(parseGithubRemote('https://github.com/acme/centinel.git')).toEqual({
      owner: 'acme',
      repo: 'centinel',
      remoteUrl: 'https://github.com/acme/centinel.git',
    });
  });

  it('derives owner and repository from SSH remotes', () => {
    expect(parseGithubRemote('git@github.com:acme/centinel.git')).toEqual({
      owner: 'acme',
      repo: 'centinel',
      remoteUrl: 'git@github.com:acme/centinel.git',
    });
  });

  it('does not treat another host as a GitHub collaboration target', () => {
    expect(parseGithubRemote('https://git.example.com/acme/centinel.git')).toBeNull();
    expect(parseGithubRemote('')).toBeNull();
  });
});
