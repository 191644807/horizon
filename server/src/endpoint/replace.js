'use strict';

const replace = require('../schema/horizon_protocol').replace;
const reql_options = require('./common').reql_options;
const writes = require('./writes');

const Joi = require('joi');
const r = require('rethinkdb');

const run = (raw_request, context, ruleset, metadata, send, done) => {
  const parsed = Joi.validate(raw_request.options, replace);
  if (parsed.error !== null) { throw new Error(parsed.error.details[0].message); }

  const collection = metadata.collection(parsed.value.collection);
  const conn = metadata.connection();

  writes.retry_loop(parsed.value.data, ruleset, parsed.value.timeout,
    (rows) => // pre-validation, all rows
      r.expr(rows.map((row) => row.id))
        .map((id) => collection.table.get(id))
        .run(conn, reql_options),
    (row, info) => { // validation, each row
      if (info === null) {
        return new Error(writes.missing_error);
      }

      const old_version = info && info[writes.version_field];
      const expected_version = row[writes.version_field];
      if (expected_version !== undefined &&
          expected_version !== old_version) {
        return new Error(writes.invalidated_error);
      } else if (!ruleset.validate(context, info, row)) {
        return new Error(writes.unauthorized_error);
      }

      if (expected_version === undefined) {
        row[writes.version_field] =
          old_version === undefined ? -1 : old_version;
      }
    },
    (rows) => // write to database, all valid rows
      r.expr(rows)
        .forEach((new_row) =>
          collection.table.get(new_row('id')).replace((old_row) =>
              r.branch(// The row may have been deleted between the get and now
                       old_row.eq(null),
                       r.error(writes.missing_error),

                       // The row may have been changed between the get and now
                       old_row(writes.version_field).default(-1).ne(new_row(writes.version_field)),
                       r.error(writes.invalidated_error),

                       // Otherwise, we can safely replace the row
                       writes.apply_version(new_row, old_row(writes.version_field).default(-1).add(1))),
              { returnChanges: 'always' }))
      .run(conn, reql_options)
  ).then(done).catch(done);
};

module.exports = { run };
