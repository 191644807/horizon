'use strict';

const check = require('../error').check;
const upsert = require('../schema/horizon_protocol').upsert;
const validate = require('../permissions/rule').validate;
const writes = require('./writes');

const Joi = require('joi');
const r = require('rethinkdb');

const run = (raw_request, context, rules, metadata, send_cb) => {
  const parsed = Joi.validate(raw_request.options, upsert);
  if (parsed.error !== null) { throw new Error(parsed.error.details[0].message); }

  const table = metadata.get_table(parsed.value.collection);
  const conn = metadata.get_connection();
  const response_data = [ ];

  r.expr(parsed.value.data)
    .map((new_row) => r.branch(new_row('id').eq(null), [ null, new_row ],
                               r.table(table.name)
                                 .get(new_row('id'))
                                 .do((old_row) => [ old_row, old_row.merge(new_row) ])))
    .run(conn)
    .then((changes) => {
      check(changes.length === parsed.value.data.length);
      const valid_rows = [ ];
      for (let i = 0; i < changes.length; ++i) {
        if (validate(rules, context, changes[i][0], changes[i][1])) {
          if (changes[i][0] === null) {
            parsed.value.data[i][writes.version_field] = undefined;
          }
          response_data.push(null);
          valid_rows.push(parsed.value.data[i]);
        } else {
          response_data.push(new Error(writes.unauthorized_error));
        }
      }

      return r.expr(valid_rows)
               .forEach((new_row) =>
                 r.branch(new_row.hasFields('id'),
                          r.table(table.name)
                            .get(new_row('id'))
                            .replace((old_row) =>
                              r.branch(r.and(old_row.eq(null),
                                             new_row.hasFields(writes.version_field)),
                                       r.error(writes.missing_error),
                                       r.or(r.and(new_row.hasFields(writes.version_field),
                                                  old_row(writes.version_field).ne(new_row(writes.version_field))),
                                            r.and(new_row.hasFields(writes.version_field).not(),
                                                  old_row.ne(null))),
                                       r.error(writes.invalidated_error),
                                       writes.add_new_version(old_row.merge(new_row))),
                              { returnChanges: 'always' }),
                           r.table(table.name)
                             .insert(writes.add_new_version(new_row),
                                     { returnChanges: 'always' })))
               .run(conn);
    }).then((upsert_results) => {
      send_cb(writes.make_write_response(response_data, upsert_results));
    }).catch(send_cb);
};

module.exports = { run };
