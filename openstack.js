const request = require('request-promise-native');
const utils = require('./utils');
const extend = require('util')._extend; // eslint-disable-line no-underscore-dangle
const cache = require('./cache');

const requestWithAuth = async (url, optsIn) => {
  let settings = await utils.getSettings();
  let opts = optsIn && JSON.parse(JSON.stringify(optsIn));
  if (!opts) {
    opts = {};
  }
  if (!opts.headers) {
    opts.headers = {};
  }
  if (!opts.headers['Content-Type']) {
    opts.headers['Content-Type'] = 'application/json';
  }

  opts.headers = extend({
    'X-Auth-Token': settings.auth.token,
  }, opts.headers);
  opts.resolveWithFullResponse = true;
  opts.transform2xxOnly = false;
  opts.simple = false;

  const hash = Buffer.from(url + JSON.stringify(opts)).toString('base64');
  if (cache.isEnabled()) {
    const cachedata = await cache.get(hash);
    if (cachedata) {
      return JSON.parse(cachedata);
    }
  }

  // console.log('openstack:', url);
  let r = await request(url, opts);
  if (r.statusCode === 401) {
    settings = await exports.loadAuth(settings);
    opts.headers['X-Auth-Token'] = settings.auth.token;
    r = await request(url, opts);
    // console.log('requestWithAuth2', r.statusCode, settings.auth.token);
  }
  if (cache.isEnabled()) {
    await cache.set(hash, JSON.stringify(r));
  }
  return r;
};

exports.loadAuth = async (settingsIn) => {
  const settings = JSON.parse(JSON.stringify(settingsIn));
  try {
    const opts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth: {
          identity: {
            methods: ['password'],
            password: {
              user: {
                name: `${settings.credentials.username}`,
                domain: { id: 'default' },
                password: `${settings.credentials.password}`,
              },
            },
          },
        },
      }),
      resolveWithFullResponse: true,
    };

    const r = await request(`${settings.credentials.url}`, opts);
    settings.auth = {
      token: r.headers['x-subject-token'],
      data: JSON.parse(r.body),
    };
    await utils.saveSettings(settings);
    // console.log('well done');
  } catch (e) {
    console.log('err', e);
  }
  return settings;
};

const getComputeURL = async settings =>
  settings.auth.data.token.catalog
    .filter(c => c.type === 'compute')[0]
    .endpoints.filter(e => e.interface === 'public')[0]
    .url;

exports.openStackRequest = async (path, rateLimit) => {
  const start = Date.now();
  let resp;

  try {
    const settings = await utils.getSettings();
    const url = await getComputeURL(settings);

    resp = await requestWithAuth(`${url}${path}`);
    // retry
    if (resp.statusCode === 504) {
      await utils.timeout(2000);
      resp = await requestWithAuth(`${url}${path}`);
    }
    const duration = Date.now() - start;

    if (!cache.isEnabled() && Number.isFinite(rateLimit) && (duration < rateLimit)) {
      await utils.timeout(rateLimit - duration);
    }

    return JSON.parse(resp.body);
  } catch (e) {
    console.log('openStackRequest err:', e, resp && resp.body);
  }

  return undefined;
};

