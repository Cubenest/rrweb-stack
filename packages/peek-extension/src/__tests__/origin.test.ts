import { describe, expect, it } from 'vitest';
import {
  type ActivationScope,
  deriveActivationRequest,
  isUrlCoveredByOrigin,
  originFromUrl,
  originMatchPattern,
} from '../activation/origin';

describe('originFromUrl', () => {
  it('extracts the origin from http(s) URLs', () => {
    expect(originFromUrl('https://example.com/path?q=1#h')).toBe('https://example.com');
    expect(originFromUrl('http://localhost:3000/app')).toBe('http://localhost:3000');
    expect(originFromUrl('https://app.example.com')).toBe('https://app.example.com');
  });

  it('preserves non-default ports', () => {
    expect(originFromUrl('https://example.com:8443/x')).toBe('https://example.com:8443');
  });

  it('rejects non-http(s) and unparseable URLs', () => {
    expect(originFromUrl('chrome://extensions')).toBeNull();
    expect(originFromUrl('chrome-extension://abc/page.html')).toBeNull();
    expect(originFromUrl('about:blank')).toBeNull();
    expect(originFromUrl('file:///Users/me/x.html')).toBeNull();
    expect(originFromUrl('data:text/html,hi')).toBeNull();
    expect(originFromUrl('not a url')).toBeNull();
    expect(originFromUrl('')).toBeNull();
    expect(originFromUrl(undefined)).toBeNull();
    expect(originFromUrl(null)).toBeNull();
  });
});

describe('originMatchPattern', () => {
  it('appends /* to the origin', () => {
    expect(originMatchPattern('https://example.com')).toBe('https://example.com/*');
    expect(originMatchPattern('https://example.com/ignored/path')).toBe('https://example.com/*');
    expect(originMatchPattern('http://localhost:3000')).toBe('http://localhost:3000/*');
  });

  it('returns null for non-activatable URLs', () => {
    expect(originMatchPattern('chrome://x')).toBeNull();
    expect(originMatchPattern(undefined)).toBeNull();
  });
});

describe('deriveActivationRequest', () => {
  it('origin scope requests the origin match pattern', () => {
    expect(deriveActivationRequest('https://example.com/page', 'origin')).toEqual({
      origin: 'https://example.com',
      origins: ['https://example.com/*'],
    });
  });

  it('tab scope requests the same origin pattern as origin scope', () => {
    // Pre-fix: this returned `origins: []` on the assumption that activeTab
    // would cover the tab — but side-panel clicks do not grant activeTab, so
    // `chrome.permissions.request({ origins: [] })` resolved to true without
    // a prompt and the subsequent executeScript refused with "Extension
    // manifest must request permission to access this host." Same pattern for
    // both scopes; only the persistence side-effect differs at the call site.
    expect(deriveActivationRequest('https://example.com/page', 'tab')).toEqual({
      origin: 'https://example.com',
      origins: ['https://example.com/*'],
    });
  });

  it('returns null for non-activatable URLs regardless of scope', () => {
    const scopes: ActivationScope[] = ['tab', 'origin'];
    for (const scope of scopes) {
      expect(deriveActivationRequest('chrome://settings', scope)).toBeNull();
      expect(deriveActivationRequest(undefined, scope)).toBeNull();
    }
  });
});

describe('isUrlCoveredByOrigin', () => {
  it('matches the same origin', () => {
    expect(isUrlCoveredByOrigin('https://example.com/a', 'https://example.com')).toBe(true);
  });

  it('does NOT match a subdomain (distinct origin, per ADR-0008)', () => {
    expect(isUrlCoveredByOrigin('https://app.example.com/a', 'https://example.com')).toBe(false);
  });

  it('does NOT match a different scheme or port', () => {
    expect(isUrlCoveredByOrigin('http://example.com/a', 'https://example.com')).toBe(false);
    expect(isUrlCoveredByOrigin('https://example.com:8443/a', 'https://example.com')).toBe(false);
  });

  it('is false for non-activatable URLs', () => {
    expect(isUrlCoveredByOrigin('chrome://x', 'https://example.com')).toBe(false);
  });
});
