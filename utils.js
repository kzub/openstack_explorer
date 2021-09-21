const fs = require('fs');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const settingsFileName = 'settings.json';

exports.getSettings = async (name) => {
  const file = await readFile(settingsFileName);
  const settings = JSON.parse(file);
  // if (!(settings && settings.auth && settings.auth.data && settings.auth.data.token)) {
  //   settings.auth = await loadAuth(settings).auth;
  // }
  if (name) {
    return settings[name];
  }
  return settings;
};

exports.saveSettings = async settings =>
  writeFile(settingsFileName, JSON.stringify(settings, null, 2));

exports.timeout = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.mapArrayByValue = (list, key) => {
  const map = {};
  for (const e of list) {
    map[e[key]] = map[e[key]] || [];
    map[e[key]].push(e);
  }
  return map;
};

exports.fillFlavorData = (srvs, flavors) => {
  for (const servername in srvs) {
    let server;
    let flavor;
    try {
      [server] = srvs[servername];
      [flavor] = flavors[server.flavor.id];
    } catch (err) {
      console.log(servername, 'no flavor data', server.flavor.id);
      process.exit();
    }

    server.flavor = {
      id: server.flavor.id,
      name: flavor.name,
      ram: flavor.ram,
      vcpus: flavor.vcpus,
      disk: flavor.disk,
    };
  }
};

// formating output
// ------------------------------------------------------
exports.printCloud = (srv, flv) => {
  for (const s in srv) {
    let mem = 0;
    let cpu = 0;
    let disk = 0;
    console.log(s, srv[s].length);
    for (const elm of srv[s]) {
      const f = flv[elm.flavor.id][0];
      console.log(elm.name, elm.id, f.vcpus, f.ram, f.disk, f.name);
      mem += f.ram;
      cpu += f.vcpus;
      disk += f.disk;
    }
    console.log(`Total RAM:${mem}, CPU:${cpu}, DISK:${disk}`);
    console.log();
  }
};

exports.printMapArray = (map, field) => {
  for (const m in map) {
    console.log(m, map[m].length);
    console.log(map[m].map(s => s[field]).join('\n'), '\n');
  }
};

exports.mapCloudResult = (map, field) => {
  const res = {};
  if (field instanceof Array) {
    for (const m in map) {
      res[m] = [];
      for (const f of field) {
        res[m].push(map[m][0][f]);
      }
    }
    return res;
  }

  for (const m in map) {
    res[m] = map[m][0][field];
    // console.log(m, map[m][0]['OS-EXT-SRV-ATTR:hypervisor_hostname']);
    // console.log(map[m].map(s => s.name).join('\n'), '\n');
  }
  return res;
};

