const utils = require('./utils');
const openstack = require('./openstack');
const hypervisor = require('./hypervisor');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

process.on('unhandledRejection', (reason) => {
  console.log('unhandledRejection:', reason);
  process.exit(-1);
});

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'auth') {
    const settings = await utils.getSettings();
    await openstack.loadAuth(settings);
    return;
  }

  if (cmd === 'list') {
    const l = await openstack.openStackRequest('/servers/detail');
    console.log(JSON.stringify(l.servers[0]));
    const map = utils.mapArrayByValue(l.servers, 'hostId');
    console.log(map);
    return;
  }

  if (cmd === 'flavors') {
    const l = await openstack.openStackRequest('/flavors/detail');
    console.log(JSON.stringify(l));
    // utils.mapArrayByValue(l.flavors, 'name');
    return;
  }

  if (cmd === 'cloud') {
    const s = await openstack.openStackRequest('/servers/detail');
    const f = await openstack.openStackRequest('/flavors/detail');
    const srv = utils.mapArrayByValue(s.servers, 'OS-EXT-SRV-ATTR:hypervisor_hostname' /* 'hostId' */);
    const flv = utils.mapArrayByValue(f.flavors, 'id');
    utils.printCloud(srv, flv);
    return;
  }

  if (cmd === 'hypervisors-la' || cmd === 'hypervisors-la2') {
    const list = await openstack.openStackRequest('/os-hypervisors/detail');
    const hypers = [];
    for (const h of list.hypervisors) {
      const uptime = await openstack.openStackRequest(`/os-hypervisors/${h.id}/uptime`, 1000);
      hypers.push({
        id: h.id,
        ...uptime,
      });
    }
    if (cmd === 'hypervisors-la2') {
      const info = hypervisor.buildHypervisorInfo(hypers);
      info.sort((a, b) => b.avg15 - a.avg15);
      console.log(info.map(e => [e.name, e.avg15].join('\t')).join('\n'));
    } else {
      const metrics = hypervisor.buildScollectorMetrics(hypers);
      console.log(metrics);
    }
    return;
  }

  if (cmd === 'cloud-json') {
    const s = await openstack.openStackRequest('/servers/detail');
    const srvs = utils.mapArrayByValue(s.servers, 'name');
    const res = utils.mapCloudResult(srvs, 'OS-EXT-SRV-ATTR:hypervisor_hostname');
    console.log(JSON.stringify(res));
    return;
  }

  if (cmd === 'cloud-la') {
    const s = await openstack.openStackRequest('/servers/detail');
    const activeServers = s.servers.filter(a => a.status === 'ACTIVE');
    const srvs = utils.mapArrayByValue(activeServers, 'name');

    const inActive = s.servers.filter(a => a.status !== 'ACTIVE');
    if (inActive.length) {
      console.log(inActive.map(a => `INACTIVE: ${a.name}`).join('\n'));
    }

    const srvsHypers = utils.mapCloudResult(srvs, ['OS-EXT-SRV-ATTR:hypervisor_hostname', 'id']);
    const hypers = hypervisor.buildHostsByHyper(srvsHypers, ['compute12.nova-msk-97.servers.com']);
    await hypervisor.fillHypersWithVMs(hypers);
    const sorterHypers = hypervisor.sortHypersByLA(hypers);

    console.log(sorterHypers.map(e => [e.name, e.sumLA.toFixed(1), e.vms.length].join(' ')).join('\n'));
    console.log('--------------------------');
    console.log('avg:', (sorterHypers.reduce((a, b) => a + b.sumLA, 0) / sorterHypers.length).toFixed(1));

    const spreadLA = 2;
    const migratePlan = hypervisor.buildMigrations(sorterHypers, spreadLA);

    console.log('--------------------------');
    migratePlan.forEach((m) => {
      console.log(`openstack server migrate ${m[2]} --live ${m[4].split('.')[0]} --block-migration # ${m[0]} ${m[1]}`);
    });

    console.log('--------------------------');
    console.log(sorterHypers.map(e => [e.name, e.sumLA.toFixed(1), e.vms.length].join(' ')).join('\n'));
    return;
  }

  console.log('node cmd <...>\n');
}

main();
// console.log('Press any key to continue.');
// process.stdin.once('data', () => {
//   main();
// });
