'use strict';

const check = require('../error').check;
const update = require('../schema/horizon_protocol').update;
const writes = require('./writes');

const Joi = require('joi');
const r = require('rethinkdb');

const run = (raw_request, context, ruleset, metadata, send, done) => {
  const parsed = Joi.validate(raw_request.options, update);
  if (parsed.error !== null) { throw new Error(parsed.error.details[0].message); }

  const collection = metadata.get_collection(parsed.value.collection);
  const conn = metadata.connection();
  const response_data = [ ];

  r.expr(parsed.value.data)
    .map((new_row) =>
      r.table(collection.table)
        .get(new_row('id'))
        .do((old_row) => [ old_row, old_row.merge(new_row) ]))
    .run(conn)
    .then((changes) => {
      check(changes.length === parsed.value.data.length);
      const valid_rows = [ ];
      for (let i = 0; i < changes.length; ++i) {
        if (ruleset.validate(context, changes[i][0], changes[i][1])) {
          valid_rows.push(parsed.value.data[i]);
          response_data.push(null);
        } else {
          response_data.push(new Error(writes.unauthorized_error));
        }
      }

      return r.expr(valid_rows)
               .forEach((new_row) =>
                 r.table(collection.table)
                   .get(new_row('id'))
                   .replace((old_row) =>
                     r.branch(old_row.eq(null),
                              r.error(writes.missing_error),
                              old_row(writes.version_field).ne(new_row(writes.version_field)),
                              r.error(writes.invalidated_error),
                              writes.add_new_version(old_row.merge(new_row))),
                     { returnChanges: 'always' }))
               .run(conn);
    }).then((update_results) => {
      done(writes.make_write_response(response_data, update_results));
    }).catch(done);
};

module.exports = { run };
