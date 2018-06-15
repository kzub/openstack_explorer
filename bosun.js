// Bosun
// ------------------------------------------------------
async function getHypervisitorsLA() {
  let settings = await utils.getSettings();
  const host = `${settings.bosun.host}/api/expr?date=&time=`;
  const query = 'q("avg:rate:hypervisor.avg1{hyper_name=wildcard(*)}", "1h", "")';
  const opts = {
    headers: {
      cookie: `_oauth2_proxy=${settings.bosun.oauth}`,
    },
    resolveWithFullResponse: true,
    transform2xxOnly: false,
    simple: false,
  };

  let hash = Buffer.from(url+JSON.stringify(opts)).toString('base64');
  if (cache.isEnabled()) {
    let cache = await cache.get(hash);
    if (cache) {
      return JSON.parse(cache);
    }
  }

  let r = await request(url, opts);
  if (r.statusCode === 401) {
    settings = await openstack.loadAuth(settings);
    opts.headers['X-Auth-Token'] = settings.auth.token
    r = await request(url, opts);
  }
}