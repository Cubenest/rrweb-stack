/**
 * SW-side masking of the R1/R2 page-view + element-detail payloads.
 *
 * Why a separate module (not in `entrypoints/background.ts`): these helpers are
 * top-level functions that use `@cubenest/rrweb-core`'s `maskTextContent`. WXT's
 * `wxt prepare` (run as the extension's postinstall, BEFORE `pnpm build`) keeps an
 * entrypoint's TOP-LEVEL exports but elides its `defineBackground` callback body —
 * so an rrweb-core import kept alive by a top-level entrypoint export forces Vite
 * to resolve rrweb-core's gitignored, unbuilt `dist/` and the cold install fails.
 * Living here, these are reached only THROUGH the (elided) background callback, so
 * the rrweb-core import is tree-shaken during type-gen — matching how the recorder
 * relay (`relay/mask.ts`) is only reached through entrypoint callbacks.
 *
 * The MAIN-world walker/drill-in already dropped raw sensitive input VALUES
 * in-page (`•••`); this is the SW's defense-in-depth pass over names/values/text.
 */

import { maskTextContent } from '@cubenest/rrweb-core';
import { maskUrl } from '../relay/mask-url';
import type { ElementDetail, PageViewNode } from './snapshot';

/**
 * SW-side masking of ONE page-view node (R1/R2). The MAIN-world walker already
 * dropped raw sensitive input VALUES in-page (`•••`); here we additionally mask
 * the accessible name + any non-sensitive value through `maskTextContent` before
 * anything leaves the device. `state`/`role`/`ref` are structural and carry no
 * page text, so they pass through. Shared by the `page_view` branch and the
 * `observe` diff path so both mask identically.
 */
export function maskPageViewNode(node: PageViewNode): PageViewNode {
  const masked: { ref: string; role: string; name: string; value?: string; state?: string } = {
    ref: node.ref,
    role: node.role,
    name: maskTextContent(node.name),
  };
  if (node.value !== undefined) {
    // The `•••` placeholder is already a redaction marker — never run it through
    // the masker (it isn't page text, and masking it is a no-op anyway).
    masked.value = node.value === '•••' ? '•••' : maskTextContent(node.value);
  }
  if (node.state !== undefined) masked.state = node.state;
  return masked;
}

/**
 * SW-side masking of an {@link ElementDetail} (R2 `element_detail` read). The
 * MAIN-world drill-in already dropped raw sensitive input VALUES in-page (`•••`);
 * here we mask every page-text string before it leaves the device:
 *   - `name`, `value`, `text`           → `maskTextContent`
 *   - every `aria-*` VALUE (keys kept)  → `maskTextContent`
 *   - `href`                            → `maskUrl` (same path/query mask as network)
 *   - each `children[].name`            → `maskTextContent`
 * Structural fields (`ref`/`tag`/`role`/`type`/`state`/`rect`/`visible`/`context`
 * landmark) carry no free page text; `context.heading` IS page text, so it is
 * masked too.
 */
export function maskElementDetail(detail: ElementDetail): ElementDetail {
  const aria: Record<string, string> = {};
  for (const [k, v] of Object.entries(detail.aria)) aria[k] = maskTextContent(v);

  const out: {
    ok: true;
    ref: string;
    tag: string;
    role: string;
    name: string;
    value?: string;
    type?: string;
    href?: string;
    state: string[];
    aria: Record<string, string>;
    rect: { x: number; y: number; w: number; h: number };
    visible: boolean;
    text?: string;
    context?: { heading?: string; landmark?: string };
    children?: { ref: string; role: string; name: string }[];
    computedStyles?: Record<string, string>;
    description?: string;
    effectiveAriaHidden?: boolean;
    effectiveAriaDisabled?: boolean;
  } = {
    ok: true,
    ref: detail.ref,
    tag: detail.tag,
    role: detail.role,
    name: maskTextContent(detail.name),
    state: detail.state,
    aria,
    rect: detail.rect,
    visible: detail.visible,
  };

  if (detail.value !== undefined) {
    out.value = detail.value === '•••' ? '•••' : maskTextContent(detail.value);
  }
  if (detail.type !== undefined) out.type = detail.type;
  if (detail.href !== undefined) out.href = maskUrl(detail.href);
  if (detail.text !== undefined) out.text = maskTextContent(detail.text);
  if (detail.context !== undefined) {
    const ctx: { heading?: string; landmark?: string } = {};
    if (detail.context.heading !== undefined) ctx.heading = maskTextContent(detail.context.heading);
    if (detail.context.landmark !== undefined) ctx.landmark = detail.context.landmark;
    out.context = ctx;
  }
  if (detail.children !== undefined) {
    out.children = detail.children.map((c) => ({
      ref: c.ref,
      role: c.role,
      name: maskTextContent(c.name),
    }));
  }
  if (detail.description !== undefined) out.description = maskTextContent(detail.description);
  if (detail.effectiveAriaHidden !== undefined)
    out.effectiveAriaHidden = detail.effectiveAriaHidden;
  if (detail.effectiveAriaDisabled !== undefined)
    out.effectiveAriaDisabled = detail.effectiveAriaDisabled;
  if (detail.computedStyles !== undefined) {
    const styles: Record<string, string> = {};
    for (const [k, v] of Object.entries(detail.computedStyles)) {
      // Only backgroundImage can carry a data-bearing url(...); everything else is
      // layout/paint values (display, color, fontSize, …) — pass through untouched.
      if (k === 'backgroundImage') {
        // Mask EVERY url() — CSS allows comma-separated multi-backgrounds and
        // getComputedStyle returns them in one string; a query secret in any
        // layer must not escape this masking boundary.
        styles[k] = v.replace(
          /url\((['"]?)([^'")]+)\1\)/g,
          (_full, q, u) => `url(${q}${maskUrl(u)}${q})`,
        );
      } else {
        styles[k] = v;
      }
    }
    out.computedStyles = styles;
  }
  return out;
}
