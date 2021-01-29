const utils = require('./utils');
const request = require('request-promise-native');

let prometheusConfig;

// eslint-disable-next-line
// const querySelected = ('100 - (avg by (instance) (irate(node_cpu_seconds_total{job="node",mode="idle"}[5m])) * 100)');
// eslint-disable-next-line
// const querySelected = ('(avg by (instance) (irate(node_cpu_seconds_total{job="node",mode="iowait"}[5m])))');
exports.FetchMeetrics = async () => {
  if (!prometheusConfig) {
    prometheusConfig = await utils.getSettings('prometheus');
  }

  let hostsLA = {};
  const querySelected = 'node_load15';
  const measureTime = 15 * 60; // seconds
  const measureTimeShift = 5 * 60; // seconds
  const end = ((Date.now() / 1000) - measureTimeShift).toFixed(3);
  const start = ((Date.now() / 1000) - measureTime - measureTimeShift).toFixed(3);
  const query = `${prometheusConfig.host}/api/v1/query_range?query=${querySelected}&start=${start}&end=${end}&step=${measureTime + 1}`;
  // console.log(query);

  try {
    const res = await request.post(query, {
      headers: {
        Authorization: prometheusConfig.auth,
      },
    });

    const response = JSON.parse(res);
    if (response.status !== 'success') {
      throw new Error(`Prometheus response  status error + ${response.status}`);
    }
    // console.log(response.data.result[0])
    hostsLA = response.data.result.reduce((a, b) => {
      a[b.metric.instance] = +b.values[0][1]; // eslint-disable-line
      // console.log(b.metric.instance, b.values[0][1])
      return a;
    }, {});
  } catch (err) {
    console.log('prometheusFetchMeetrics() error:', err);
    throw new Error(err);
  }
  return hostsLA;
};
