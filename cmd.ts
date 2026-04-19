#!/usr/bin/env node
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';
import { publishWithCredential } from './utility/publish';

const argv = yargs(hideBin(process.argv))
  .option("publish", {
    type: "string",
    requiresArg: false,
    coerce: val => val === "" ? './.swan-auth' : val
  })
  .option("base-url", {
    type: "string",
    requiresArg: false,
    coerce: val => val === "" ? '' : val
  })
  .parse() as { publish: string, 'base-url': string };

const auth_credential_path = argv.publish;
const base_url = argv['base-url'] || 'https://pub.ssww.one';
if (!auth_credential_path) {
  console.error([
    'Wrong usage!',
    'You must use --publish to publish your AI-Agent',
    '',
    'Example:',
    'swanc --publish',
    '',
  ].join('\n'));
  process.exit(1);
}

publishWithCredential(base_url, auth_credential_path).catch(e => console.log(e.toString()));
