'use strict';

const {r} = require('@horizon/server');
const {reqlOptions, writes} = require('@horizon/plugin-utils');
const hzv = writes.versionField;

function store(context) {
  return (request, response, next) => {
    const conn = context.horizon.rdbConnection.connection();
    const timeout = request.getParameter('timeout');
    const collection = request.getParameter('collection');
    const permissions = request.getParameter('hz_permissions');

    if (!collection) {
      throw new Error('No collection given for insert operation.');
    } else if (!permissions) {
      throw new Error('No permissions given for insert operation.');
    }

    writes.retryLoop(request.options.store, permissions, timeout,
      (rows) => // pre-validation, all rows
        r.expr(rows.map((row) => (row.id === undefined ? null : row.id)))
          .map((id) => r.branch(id.eq(null), null, collection.table.get(id)))
          .run(conn, reqlOptions),
      (validator, row, info) =>
        writes.validateOldRowOptional(validator, row, info, row),
      (rows) => // write to database, all valid rows
        r.expr(rows)
          .forEach((newRow) =>
            r.branch(newRow.hasFields('id'),
                     collection.table.get(newRow('id')).replace((oldRow) =>
                         r.branch(
                           oldRow.eq(null),
                           r.branch(
                             // Error if we were expecting the row to exist
                             newRow.hasFields(hzv),
                             r.error(writes.invalidatedMsg),

                             // Otherwise, insert the row
                             writes.applyVersion(newRow, 0)
                           ),
                           r.branch(
                             // The row may have changed from the expected version
                             r.and(newRow.hasFields(hzv),
                                   oldRow(hzv).default(-1).ne(newRow(hzv))),
                             r.error(writes.invalidatedMsg),

                             // Otherwise, we can overwrite the row
                             writes.applyVersion(newRow,
                                                 oldRow(hzv).default(-1).add(1))
                           )
                         ), {returnChanges: 'always'}),

                     // The new row does not have an id, so it will autogenerate
                     collection.table.insert(writes.applyVersion(newRow, 0),
                                             {returnChanges: 'always'})))
          .run(conn, reqlOptions)
    ).then((msg) => response.end(msg)).catch(next);
  };
}

module.exports = {
  name: 'hz_store',
  activate: (context) => ({
    methods: {
      store: {
        type: 'terminal',
        requires: ['hz_permissions'],
        handler: store(context),
      },
    },
  }),
};
