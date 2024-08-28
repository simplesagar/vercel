/* eslint-env jest */
const path = require('path');
const { deployAndTest } = require('../../utils');
const fetch = require('../../../../../test/lib/deployment/fetch-retry');
const cheerio = require('cheerio');

const pages = [
  { pathname: '/', dynamic: true },
  { pathname: '/nested/a', dynamic: true },
  { pathname: '/nested/b', dynamic: true },
  { pathname: '/nested/c', dynamic: true },
  { pathname: '/on-demand/a', dynamic: true },
  { pathname: '/on-demand/b', dynamic: true },
  { pathname: '/on-demand/c', dynamic: true },
  { pathname: '/loading/a', dynamic: true },
  { pathname: '/loading/b', dynamic: true },
  { pathname: '/loading/c', dynamic: true },
  { pathname: '/static', dynamic: false },
  { pathname: '/no-suspense', dynamic: true },
  { pathname: '/no-suspense/nested/a', dynamic: true },
  { pathname: '/no-suspense/nested/b', dynamic: true },
  { pathname: '/no-suspense/nested/c', dynamic: true },
  { pathname: '/no-fallback/a', dynamic: true },
  { pathname: '/no-fallback/b', dynamic: true },
  { pathname: '/no-fallback/c', dynamic: true },
  // TODO: uncomment when we've fixed the 404 case for force-dynamic pages
  // { pathname: '/dynamic/force-dynamic', dynamic: 'force-dynamic' },
  { pathname: '/dynamic/force-static', dynamic: 'force-static' },
];

const cases = {
  404: [
    // For routes that do not support fallback (they had `dynamicParams` set to
    // `false`), we shouldn't see any fallback behavior for routes not defined
    // in `getStaticParams`.
    { pathname: '/no-fallback/non-existent' },
  ],
};

const ctx = {};

describe(`${__dirname.split(path.sep).pop()}`, () => {
  beforeAll(async () => {
    await require('../../utils').normalizeReactVersion(__dirname);
    const info = await deployAndTest(__dirname);
    Object.assign(ctx, info);
  });

  it('should handle interception route properly', async () => {
    const res = await fetch(`${ctx.deploymentUrl}/cart`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('normal cart page');

    const res2 = await fetch(`${ctx.deploymentUrl}/cart`, {
      headers: {
        RSC: '1',
      },
    });
    const res2Body = await res2.text();
    expect(res2.status).toBe(200);
    expect(res2Body).toContain(':');
    expect(res2Body).not.toContain('<html');

    const res3 = await fetch(`${ctx.deploymentUrl}/cart`, {
      headers: {
        RSC: '1',
        'Next-Url': '/cart',
        'Next-Router-Prefetch': '1',
      },
    });
    const res3Body = await res3.text();
    expect(res3.status).toBe(200);
    expect(res3Body).toContain(':');
    expect(res3Body).not.toContain('<html');

    const res4 = await fetch(`${ctx.deploymentUrl}/cart`, {
      headers: {
        RSC: '1',
        'Next-Url': '/cart',
      },
    });
    const res4Body = await res4.text();
    expect(res4.status).toBe(200);
    expect(res4Body).toContain(':');
    expect(res4Body).not.toContain('<html');
  });

  describe('dynamic pages should resume', () => {
    it.each(pages.filter(p => p.dynamic === true))(
      'should resume $pathname',
      async ({ pathname }) => {
        const expected = `${Date.now()}:${Math.random()}`;
        const res = await fetch(`${ctx.deploymentUrl}${pathname}`, {
          headers: { 'X-Test-Input': expected },
        });
        expect(res.status).toEqual(200);
        expect(res.headers.get('content-type')).toEqual(
          'text/html; charset=utf-8'
        );
        const html = await res.text();
        expect(html).toContain(expected);
        expect(html).toContain('</html>');

        // Validate that the loaded URL is correct.
        expect(html).toContain(`data-pathname=${pathname}`);
      }
    );

    it.each(cases[404])(
      'should return 404 for $pathname',
      async ({ pathname }) => {
        const res = await fetch(`${ctx.deploymentUrl}${pathname}`);
        expect(res.status).toEqual(404);
      }
    );
  });

  describe('prefetch RSC payloads should return', () => {
    it.each(pages)(
      'should prefetch $pathname',
      async ({ pathname, dynamic }) => {
        const unexpected = `${Date.now()}:${Math.random()}`;
        const res = await fetch(`${ctx.deploymentUrl}${pathname}`, {
          headers: {
            RSC: '1',
            'Next-Router-Prefetch': '1',
            'X-Test-Input': unexpected,
          },
        });
        expect(res.status).toEqual(200);
        expect(res.headers.get('content-type')).toEqual('text/x-component');

        const cache = res.headers.get('cache-control');
        expect(cache).toContain('public');
        expect(cache).toContain('must-revalidate');

        // Expect that static RSC prefetches do not contain the dynamic text.
        const text = await res.text();
        expect(text).not.toContain(unexpected);

        if (dynamic === true) {
          // The dynamic component will contain the text "needle" if it was
          // rendered using dynamic content.
          expect(text).not.toContain('needle');
          expect(res.headers.get('X-NextJS-Postponed')).toEqual('1');
        } else {
          if (dynamic !== false) {
            expect(text).toContain('needle');
          }

          expect(res.headers.has('X-NextJS-Postponed')).toEqual(false);
        }
      }
    );

    it.each(cases[404])(
      'should return 404 for $pathname',
      async ({ pathname }) => {
        const res = await fetch(`${ctx.deploymentUrl}${pathname}`, {
          headers: { RSC: 1, 'Next-Router-Prefetch': '1' },
        });
        expect(res.status).toEqual(404);
      }
    );
  });

  describe('dynamic RSC payloads should return', () => {
    it.each(pages)('should fetch $pathname', async ({ pathname, dynamic }) => {
      const expected = `${Date.now()}:${Math.random()}`;
      const res = await fetch(`${ctx.deploymentUrl}${pathname}`, {
        headers: { RSC: '1', 'X-Test-Input': expected },
      });
      expect(res.status).toEqual(200);
      expect(res.headers.get('content-type')).toEqual('text/x-component');
      expect(res.headers.has('X-NextJS-Postponed')).toEqual(false);

      const cache = res.headers.get('cache-control');
      expect(cache).toContain('private');
      expect(cache).toContain('no-store');
      expect(cache).toContain('no-cache');
      expect(cache).toContain('max-age=0');
      expect(cache).toContain('must-revalidate');

      const text = await res.text();

      if (dynamic !== false) {
        expect(text).toContain('needle');
      }

      if (dynamic === true) {
        // Expect that dynamic RSC prefetches do contain the dynamic text.
        expect(text).toContain(expected);
      } else {
        // Expect that dynamic RSC prefetches do not contain the dynamic text
        // when we're forced static.
        expect(text).not.toContain(expected);
      }
    });

    it.each(cases[404])(
      'should return 404 for $pathname',
      async ({ pathname }) => {
        const res = await fetch(`${ctx.deploymentUrl}${pathname}`, {
          headers: { RSC: 1 },
        });
        expect(res.status).toEqual(404);
      }
    );
  });

  describe('fallback should be used correctly', () => {
    const assertRouteShell = $ => {
      expect($('[data-loading]').length).toEqual(1);
      expect($('[data-page]').closest('[hidden]').length).toEqual(0);
    };

    const assertFallbackShell = $ => {
      expect($('[data-loading]').length).toEqual(1);
      expect($('[data-page]').closest('[hidden]').length).toEqual(1);
    };

    const assertDynamicPostponed = $ => {
      expect($('[data-agent]').closest('[hidden]').length).toEqual(1);
    };

    it('should use the fallback shell on the first request', async () => {
      const res = await fetch(`${ctx.deploymentUrl}/fallback/first`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('PRERENDER');

      const html = await res.text();
      const $ = cheerio.load(html);
      expect($('[data-loading]').length).toEqual(1);
      expect($('[data-page]').closest('[hidden]').length).toEqual(1);
    });

    it('should use the route shell on the second request', async () => {
      let res = await fetch(`${ctx.deploymentUrl}/fallback/second`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('PRERENDER');

      let html = await res.text();
      let $ = cheerio.load(html);
      assertFallbackShell($);

      res = await fetch(`${ctx.deploymentUrl}/fallback/second`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('HIT');

      html = await res.text();
      $ = cheerio.load(html);
      assertRouteShell($);
    });

    it('should handle dynamic resumes on the fallback pages', async () => {
      const res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/first`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('PRERENDER');

      let html = await res.text();
      let $ = cheerio.load(html);
      assertFallbackShell($);
      assertDynamicPostponed($);

      html = await res.text();
      $ = cheerio.load(html);
      assertRouteShell($);
      assertDynamicPostponed($);
    });

    it('should serve the fallback shell for new pages', async () => {
      let res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/second`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('PRERENDER');

      let html = await res.text();
      let $ = cheerio.load(html);
      assertFallbackShell($);
      assertDynamicPostponed($);

      res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/second`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('HIT');

      html = await res.text();
      $ = cheerio.load(html);
      assertRouteShell($);
      assertDynamicPostponed($);

      res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/third`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('PRERENDER');

      html = await res.text();
      $ = cheerio.load(html);
      assertFallbackShell($);
      assertDynamicPostponed($);

      res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/third`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('HIT');

      html = await res.text();
      $ = cheerio.load(html);
      assertRouteShell($);
      assertDynamicPostponed($);
    });

    it('should revalidate the pages and perform a blocking render when the fallback is revalidated', async () => {
      let res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/fourth`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('PRERENDER');

      let html = await res.text();
      let $ = cheerio.load(html);
      assertFallbackShell($);

      res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/fourth`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('HIT');

      html = await res.text();
      $ = cheerio.load(html);
      assertRouteShell($);

      // Send the revalidation request.
      res = await fetch(
        `${ctx.deploymentUrl}/api/revalidate/fallback/dynamic/fourth`,
        {
          method: 'DELETE',
        }
      );
      expect(res.status).toEqual(200);

      // Wait for the revalidation to be applied.
      await new Promise(resolve => setTimeout(resolve, 1000));

      res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/fourth`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('REVALIDATED');

      html = await res.text();
      $ = cheerio.load(html);
      assertRouteShell($);

      res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/fifth`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('PRERENDER');

      html = await res.text();
      $ = cheerio.load(html);
      assertFallbackShell($);
      assertDynamicPostponed($);

      res = await fetch(`${ctx.deploymentUrl}/fallback/dynamic/fifth`);
      expect(res.status).toEqual(200);
      expect(res.headers.get('x-vercel-cache')).toEqual('HIT');

      html = await res.text();
      $ = cheerio.load(html);
      assertRouteShell($);
      assertDynamicPostponed($);
    });
  });
});
