// The seven tools, on top of a lobby and tables that are either local objects (Node) or Durable Object stubs (Worker).
// lobby: { alloc(ip), quick(), list() }; table(code): { create, join, start, move, getState }.
const CODE = /^[A-Za-z]{4}$/;
const code = (v) => {
  if (typeof v !== 'string' || !CODE.test(v)) throw new Error('table must be a 4-letter code, like "KDRT".');
  return v.toUpperCase();
};
const token = (v) => {
  if (typeof v !== 'string' || !/^[0-9a-f]{32}$/.test(v)) throw new Error('token must be the token join_table gave you.');
  return v;
};
const optInt = (v, label) => {
  if (v === undefined || v === null) return undefined;
  if (!Number.isInteger(v)) throw new Error(`${label} must be a whole number.`);
  return v;
};
const cfg = (a) => ({ dice: optInt(a.dice, 'dice'), seats: optInt(a.seats, 'seats'), turn_seconds: optInt(a.turn_seconds, 'turn_seconds'), public: a.public !== false });

export function makeCall({ lobby, table, recordBase }) {
  const withRecord = (v) => { if (v && v.status === 'over') v.record_url = `${recordBase}/record/${v.table}`; return v; };
  async function create(a, ip) {
    const c = await lobby.alloc(ip);
    return table(c).create(c, cfg(a));
  }
  return async function call(name, a, ip) {
    switch (name) {
      case 'list_tables': return lobby.list();
      case 'create_table': return create(a, ip);
      case 'join_table': {
        if (a.table !== undefined && a.table !== null && a.table !== '') return table(code(a.table)).join(a.name);
        for (let i = 0; i < 2; i++) {
          const c = await lobby.quick();
          if (!c) break;
          try { return await table(c).join(a.name); } catch (e) { if (!/full|already started|No table/.test(e.message)) throw e; }
        }
        const { table: c } = await create({}, ip);
        return table(c).join(a.name);
      }
      case 'start_game': return withRecord(await table(code(a.table)).start(token(a.token), optInt(a.bots, 'bots')));
      case 'get_state': {
        const tk = a.token === undefined || a.token === null || a.token === '' ? null : token(a.token);
        return withRecord(await table(code(a.table)).getState(tk, optInt(a.wait_seconds, 'wait_seconds') ?? 0, optInt(a.since, 'since')));
      }
      case 'bid': return withRecord(await table(code(a.table)).move(token(a.token), 'bid', { quantity: a.quantity, face: a.face, say: a.say }));
      case 'challenge': return withRecord(await table(code(a.table)).move(token(a.token), 'challenge', { say: a.say }));
      default: throw new Error(`Unknown tool ${name}.`);
    }
  };
}
