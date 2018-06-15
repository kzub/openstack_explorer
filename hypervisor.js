const prometheus = require('./prometheus');

const getStatUptime = (str) => {
  // 16:09:15 up 4 days,  4:17,  0 users,  load average: 31.37, 32.69, 33.35\n
  // 15:18:07 up 36 min,  1 user,  load average: 0.75, 0.60, 0.47
  const [uptimeFull] = str.split(',');
  const [, uptimeDays] = uptimeFull.split('up');
  const [, avgs] = str.split('load average:');
  let [avg1, avg5, avg15] = avgs.split(',');

  avg1 = +avg1;
  avg5 = +avg5;
  avg15 = +avg15.replace('\n', '');

  let [, uptime, ] = uptimeDays.split(' '); // eslint-disable-line
  uptime = +uptime;
  // console.log(avg1, avg5, avg15, uptime);
  return {
    avg1,
    avg5,
    avg15,
    uptime,
  };
};

// { name: 'compute11.nova-msk-97.servers.com', avg1: 31.37, avg5: 32.69, avg15: 33.35, uptime: 4 }
// linux.disk.mdadm.state 1527695835 1 type=megacli volume=megaraid
exports.buildHypervisorInfo = hypers => hypers
  .filter(elm => elm && elm.hypervisor)
  .map(elm => {
    return {
      name: elm.hypervisor.hypervisor_hostname,
      ...getStatUptime(elm.hypervisor.uptime),
    };
  });


exports.buildScollectorMetrics = (hypers) => {
  const info = exports.buildHypervisorInfo(hypers);
  const ts = Math.floor(Date.now() / 1000);
  return info.map(h =>
    [
      `hypervisor.uptime ${ts} ${h.uptime} hyper_name=${h.name}`,
      `hypervisor.avg1 ${ts} ${h.avg1} hyper_name=${h.name}`,
      // `hypervisor.avg5 ${ts} ${h.avg5} hyper_name=${h.name}`,
      // `hypervisor.avg15 ${ts} ${h.avg15} hyper_name=${h.name}`,
    ].join('\n')).join('\n');
};

exports.buildHostsByHyper = (srvsHypers, exclude) => {
  const hypers = Object.entries(srvsHypers).reduce((a, b) => {
    const [host, [hyper, id]] = b;
    if (exclude && exclude.indexOf(hyper) > -1) {
      return a;
    }
    a[hyper] = a[hyper] || []; // eslint-disable-line
    a[hyper].push({ host, id });
    return a;
  }, {});
  return hypers;
};


let prometheusMetrics;
exports.getHostLA = async (host) => {
  if (!prometheusMetrics) {
    prometheusMetrics = await prometheus.FetchMeetrics();
  }
  const value = prometheusMetrics[host];
  if (!Number.isFinite(value)) {
    console.log('NO_METRICS:', host);
  }
  return value || 0;
};

exports.fillHypersWithVMs = async (hypers, include) => {
  for (const hyper in hypers) {
    const vms = hypers[hyper];
    // console.log(hyper, vms.length);

    for (const vm of vms) {
      if (include && include.indexOf(vm.host) === -1) {
        continue;
      }
      // console.log(vm.host)
      const LA = await exports.getHostLA(vm.host);
      vm.LA = LA;
      // console.log(la)
    }
  }
};

exports.sortHypersByLA = (hypers) => {
  // строим структуру с гипервизором, виртуалками и их LA
  const sorterHypers = [];

  for (const name in hypers) {
    const vms = hypers[name];
    vms.sort((a, b) => b.LA - a.LA);
    const sumLA = vms.reduce((a, b) => (a + b.LA), 0);
    sorterHypers.push({ name, sumLA, vms });
  }

  sorterHypers.sort((a, b) => b.sumLA - a.sumLA);

  sorterHypers.forEach((h) => {
    // console.log(h.name, h.sumLA.toFixed(1), h.vms.length);
    h.vms.sort((a, b) => b.LA - a.LA);
    // console.log(h.vms.map(a=>a.host).join('\n'));
  });
  return sorterHypers;
};

exports.buildMigrations = (sorterHypers, spreadLA) => {
  const migratePlan = [];
  const avg = sorterHypers.reduce((a, b) => a + b.sumLA, 0) / sorterHypers.length;

  const goodLA = (host) => Math.abs(host.sumLA - avg) < spreadLA;
  const lowLA = (host) => host.sumLA <= (avg - spreadLA);
  const highLA = (host) => host.sumLA >= (avg + spreadLA);
  const migrate = (host1, vm, host2) => {
    host1.sumLA = host1.sumLA - vm.LA; // eslint-disable-line
    host2.sumLA = host2.sumLA + vm.LA; // eslint-disable-line
    migratePlan.push([host1.name, vm.LA, vm.host, vm.id, host2.name]);
    host1.vms = host1.vms.filter(v => v.host !== vm.host); // eslint-disable-line
    host2.vms.push(vm);
  };
  const fitToMigrate = (vm, host) => (vm.LA > spreadLA) && (host.sumLA + vm.LA) < avg;
  const migrateVMfilter = (vm) =>
    vm.host.match(/(search|parser|hotels|order|common|bus|seopages|railways|multimodal|statistics|pricealert|multiservice|extranet|report|queue|seo|other)-.*/);

  // строим карту миграций
  for (let i1 = 0; i1 < sorterHypers.length; i1++) {
    // откуда
    const host1 = sorterHypers[i1];
    if (goodLA(host1) || lowLA(host1)) {
      continue;
    }

    for (let i2 = 0; i2 < sorterHypers.length; i2++) {
      // куда
      const host2 = sorterHypers[i2];
      if (goodLA(host2) || highLA(host2)) {
        // console.log('host2', host2.name, goodLA(host2) &&'GOOD', highLA(host2) &&'HIGH')
        continue;
      }
      // console.log('host2 OK ',host2.name)
      const vms = host1.vms.filter(migrateVMfilter);

      for (let i3 = 0; i3 < vms.length; i3++) {
        const vm = vms[i3];
        if (highLA(host2) || goodLA(host1) || lowLA(host1)) {
          break;
        }
        if (fitToMigrate(vm, host2)) {
          migrate(host1, vm, host2);
        }
      }

      if (goodLA(host1) || lowLA(host1)) {
        break;
      }
    }
  }

  return migratePlan;
};
