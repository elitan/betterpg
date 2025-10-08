import { describe, test, expect } from 'bun:test';
import { parseNamespace, buildNamespace, isNamespaced, getMainBranch } from './namespace';

describe('parseNamespace', () => {
  test('parses valid namespaced name', () => {
    const result = parseNamespace('api/dev');
    expect(result).toEqual({
      project: 'api',
      branch: 'dev',
      full: 'api/dev',
    });
  });

  test('parses names with hyphens and underscores', () => {
    const result = parseNamespace('my-api_v2/feature-branch_test');
    expect(result).toEqual({
      project: 'my-api_v2',
      branch: 'feature-branch_test',
      full: 'my-api_v2/feature-branch_test',
    });
  });

  test('throws error for non-namespaced name', () => {
    expect(() => parseNamespace('api')).toThrow(
      "Invalid namespace format: 'api'. Expected format: <project>/<branch>"
    );
  });

  test('throws error for too many slashes', () => {
    expect(() => parseNamespace('api/dev/extra')).toThrow(
      "Invalid namespace format: 'api/dev/extra'. Expected format: <project>/<branch>"
    );
  });

  test('throws error for empty project', () => {
    expect(() => parseNamespace('/branch')).toThrow(
      "Invalid namespace format: '/branch'. Project and branch names cannot be empty"
    );
  });

  test('throws error for empty branch', () => {
    expect(() => parseNamespace('project/')).toThrow(
      "Invalid namespace format: 'project/'. Project and branch names cannot be empty"
    );
  });

  test('throws error for invalid characters in project', () => {
    expect(() => parseNamespace('api@123/dev')).toThrow(
      "Invalid project name: 'api@123'. Only alphanumeric characters, hyphens, and underscores are allowed"
    );
  });

  test('throws error for invalid characters in branch', () => {
    expect(() => parseNamespace('api/dev#123')).toThrow(
      "Invalid branch name: 'dev#123'. Only alphanumeric characters, hyphens, and underscores are allowed"
    );
  });
});

describe('buildNamespace', () => {
  test('builds namespaced name from components', () => {
    expect(buildNamespace('api', 'dev')).toBe('api/dev');
  });

  test('builds namespaced name with special characters', () => {
    expect(buildNamespace('my-api_v2', 'feature-test')).toBe('my-api_v2/feature-test');
  });
});

describe('isNamespaced', () => {
  test('returns true for valid namespaced name', () => {
    expect(isNamespaced('api/dev')).toBe(true);
  });

  test('returns false for non-namespaced name', () => {
    expect(isNamespaced('api')).toBe(false);
  });

  test('returns false for invalid format', () => {
    expect(isNamespaced('api/dev/extra')).toBe(false);
  });

  test('returns false for empty parts', () => {
    expect(isNamespaced('/branch')).toBe(false);
    expect(isNamespaced('project/')).toBe(false);
  });
});

describe('getMainBranch', () => {
  test('returns main branch for project', () => {
    expect(getMainBranch('api')).toBe('api/main');
  });

  test('returns main branch for project with special characters', () => {
    expect(getMainBranch('my-api_v2')).toBe('my-api_v2/main');
  });
});
