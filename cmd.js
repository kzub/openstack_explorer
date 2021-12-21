const utils = require('./utils');
const openstack = require('./openstack');
const hypervisor = require('./hypervisor');
const fs = require('fs'); // eslint-disable-line

// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

process.on('unhandledRejection', (reason) => {
  console.log('unhandledRejection:', reason);
  process.exit(-1);
});

async function main() {
  const cmd = process.argv[2];
  // ---------------------------------------------------------------------------------------------------
  if (cmd === 'auth') {
    const settings = await utils.getSettings();
    await openstack.loadAuth(settings);
    return;
  }

  // ---------------------------------------------------------------------------------------------------
  if (cmd === 'list') {
    const l = await openstack.openStackRequest('/servers/detail');
    console.log(JSON.stringify(l.servers[0]));
    const map = utils.mapArrayByValue(l.servers, 'hostId');
    console.log(map);
    return;
  }

  // ---------------------------------------------------------------------------------------------------
  if (cmd === 'flavors') {
    const l = await openstack.openStackRequest('/flavors/detail?is_public=None');
    console.log(JSON.stringify(l));
    // utils.mapArrayByValue(l.flavors, 'name');
    return;
  }

  // ---------------------------------------------------------------------------------------------------
  if (cmd === 'cloud') {
    const s = await openstack.openStackRequest('/servers/detail');
    const f = await openstack.openStackRequest('/flavors/detail?is_public=None');
    // fs.writeFileSync('servers.json', JSON.stringify(s, null, 2));
    // fs.writeFileSync('flavors.json', JSON.stringify(f, null, 2));
    const srv = utils.mapArrayByValue(s.servers, 'OS-EXT-SRV-ATTR:hypervisor_hostname' /* 'hostId' */);
    const flv = utils.mapArrayByValue(f.flavors, 'id');
    utils.printCloud(srv, flv);
    return;
  }

  // ---------------------------------------------------------------------------------------------------
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


  // elastic.index.size 1611931251 412272527 name=chef-nginx-2021.01.17 type=warm status=open

  // ---------------------------------------------------------------------------------------------------
  if (cmd === 'cloud-json') {
    const s = await openstack.openStackRequest('/servers/detail');
    const srvs = utils.mapArrayByValue(s.servers, 'name');
    const res = utils.mapCloudResult(srvs, 'OS-EXT-SRV-ATTR:hypervisor_hostname');
    console.log(JSON.stringify(res));
    return;
  }

  // ---------------------------------------------------------------------------------------------------
  if (cmd === 'cloud-la') {
    const s = await openstack.openStackRequest('/servers/detail');
    const activeServers = s.servers.filter(a => a.status === 'ACTIVE');
    const srvs = utils.mapArrayByValue(activeServers, 'name');

    const inActive = s.servers.filter(a => a.status !== 'ACTIVE');
    if (inActive.length) {
      console.log(inActive.map(a => `INACTIVE: ${a.name}`).join('\n'));
      console.log('--------------------------');
    }

    const srvsHypers = utils.mapCloudResult(srvs, ['OS-EXT-SRV-ATTR:hypervisor_hostname', 'id']);
    const hypers = hypervisor.buildHostsByHyper(srvsHypers);
    await hypervisor.fillVMsLA(hypers);
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

  // ---------------------------------------------------------------------------------------------------
  if (cmd === 'cloud-migration') {
    console.log(`> requesting hypervisors info...`);
    const list = await openstack.openStackRequest('/os-hypervisors/detail');
    console.log(`hypervisors count: ${list.hypervisors.length}`);

    const hyperInfo = {};
    for (const h of list.hypervisors) {
      console.log(`> requesting detail info for ${h.hypervisor_hostname}...`);
      const uptime = await openstack.openStackRequest(`/os-hypervisors/${h.id}/uptime`, 1000);
      hyperInfo[h.hypervisor_hostname] = {
        ...h,
        load: hypervisor.getStatUptime(uptime.hypervisor.uptime),
      };
    }

    console.log(`> requesting flavors info...`);
    const fdata = await openstack.openStackRequest('/flavors/detail?is_public=None');
    const flavors = utils.mapArrayByValue(fdata.flavors, 'id');

    console.log(`> requesting vms info...`);
    const s = await openstack.openStackRequest('/servers/detail');
    const activeServers = s.servers.filter(a => a.status === 'ACTIVE');
    const srvs = utils.mapArrayByValue(activeServers, 'name');
    utils.fillFlavorData(srvs, flavors);

    console.log('==========================');

    const inActive = s.servers.filter(a => a.status !== 'ACTIVE');
    if (inActive.length) {
      console.log(inActive.map(a => `INACTIVE: ${a.name}`).join('\n'));
      console.log('--------------------------');
    }

    const srvsHypers = utils.mapCloudResult(srvs, ['OS-EXT-SRV-ATTR:hypervisor_hostname', 'id', 'flavor']);
    const hypers = hypervisor.buildHostsByHyper(srvsHypers);
    await hypervisor.fillVMsLA(hypers);
    const sorterHypers = hypervisor.sortHypersByLA(hypers);
    hypervisor.fillHyperInfo(sorterHypers, hyperInfo);
    hypervisor.sortHypersByRealLA(sorterHypers);

    const beforeData = sorterHypers.map(h => {
      return {
        name: h.name,
        pLA: h.sumLA.toFixed(1),
        rLA: h.realLA.toFixed(1),
        vms: h.vms.length,
        mem: h.info.free_ram_mb,
        disk: h.info.free_disk_gb,
      };
    });

    console.log('--------------------------');
    const totalSumLA = (sorterHypers.reduce((a, b) => a + b.sumLA, 0)).toFixed(1);
    const totalRealLA = (sorterHypers.reduce((a, b) => a + b.realLA, 0)).toFixed(1);
    console.log(`pLA total:${totalSumLA}, avg: ${(totalSumLA / sorterHypers.length).toFixed(1)}`);
    console.log(`rLA total:${totalRealLA}, avg: ${(totalRealLA / sorterHypers.length).toFixed(1)}`);

    const spreadLA = 1;
    const migratePlan = hypervisor.buildNewMigrations(sorterHypers, spreadLA, ['compute8.nova-msk-97.servers.com', 'compute9.nova-msk-97.servers.com', 'compute10.nova-msk-97.servers.com']);

    console.log('--------------------------');
    migratePlan.forEach((m) => {
      console.log(`openstack server migrate --live-migration --host ${m.to} --block-migration --wait --os-compute-api-version 2.56 ${m.whom}`);
      // console.log(`nova live-migration --block-migrate ${m.whom} ${m.to} # from:${m.from}, pLA:${m.whomLA}, to:${m.to}`);
    });

    console.log('----------------------------------------------------------------------------------------------------------------------------------------------');
    const afterData = sorterHypers.map(h => {
      return {
        name: h.name,
        pLA: h.sumLA.toFixed(1),
        rLA: h.realLA.toFixed(1),
        vms: h.vms.length,
        mem: h.info.free_ram_mb,
        disk: h.info.free_disk_gb,
        migrations: h.migrations.join(''),
      };
    });

    const lines = afterData.map(line => {
      const before = beforeData.find(line2 => line2.name === line.name);
      return `${line.name}\t${before.pLA}->${line.pLA}\t${before.rLA}->${line.rLA}\t${before.vms}->${line.vms}\t${before.mem}->${line.mem}\t${before.disk}->${line.disk}\t${line.migrations}`;
    });
    lines.unshift(`name\t\t\t\t\tpromLA\t\trealLA\t\tVMs\tMem\t\tDisk\t\tMigrations`);
    console.log(lines.join('\n'));
    console.log('nova migration-list')
    return;
  }


  console.log('node cmd <...>\n');
}

main();
// console.log('Press any key to continue.');
// process.stdin.once('data', () => {
//   main();
// });
