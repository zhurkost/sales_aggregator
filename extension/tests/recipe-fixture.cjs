// Test-only catalog adapter. Production extension receives small JSON recipes from the server.
const taxonomy = require('../../data/taxonomy.json');
module.exports = (id='computers.gpu',overrides={}) => {
  const node = taxonomy.nodes.find(n=>n.id===(taxonomy.aliases[id]||id));
  const mappings = {...node.mappings};
  for (const [site,key] of Object.entries(overrides)) mappings[site] = taxonomy.options[site][key];
  return {protocol:1,version:taxonomy.version,taxonomyId:node.id,category:node.group,mappings,entries:[]};
};
