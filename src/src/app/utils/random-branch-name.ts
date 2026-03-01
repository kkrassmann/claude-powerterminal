/**
 * Random branch name generator for new git worktrees.
 * Produces adjective-animal combinations like "fuzzy-penguin" or "cosmic-narwhal".
 */

const ADJECTIVES = [
  'brave', 'calm', 'cosmic', 'daring', 'eager',
  'fierce', 'fuzzy', 'gentle', 'happy', 'icy',
  'jolly', 'keen', 'lazy', 'mighty', 'noble',
  'odd', 'plucky', 'quick', 'rapid', 'silent',
  'swift', 'tiny', 'vivid', 'warm', 'witty',
  'zany', 'bold', 'crisp', 'deep', 'epic',
];

const ANIMALS = [
  'badger', 'cat', 'dolphin', 'eagle', 'falcon',
  'gecko', 'hawk', 'ibis', 'jaguar', 'koala',
  'lemur', 'mole', 'narwhal', 'octopus', 'panda',
  'quail', 'raven', 'seal', 'tiger', 'urchin',
  'viper', 'walrus', 'fox', 'yak', 'zebra',
  'otter', 'penguin', 'rabbit', 'shark', 'wolf',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateRandomBranchName(): string {
  return `${randomItem(ADJECTIVES)}-${randomItem(ANIMALS)}`;
}
