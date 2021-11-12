import fs = require('fs');
import { YAMLValidation } from '../../src/services/yamlValidation';
import * as JSONSchemaService from '../../src/services/jsonSchemaService';
import { JSONSchema } from '../../src/jsonSchema';
import * as URL from 'url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver-types';
import * as yamlparser from '../../src/parser/yamlParser'
import { Thenable } from '../../src/yamlLanguageService';
import * as assert from 'assert';

describe("Yaml Validation Service Tests", function () {
    this.timeout(20000);

    it('validates empty files', async function () {
       const diagnostics = await runValidationTest("");
       assert.equal(diagnostics.length, 0);
    });

    it('validates files with emojis', async function () {
      const diagnostics = await runValidationTest(`
steps:
- pwsh: Write-Output 😊
`);
      assert.equal(diagnostics.length, 0);
   });

    it('rejects multi-document files with only one error', async function () {
        const diagnostics = await runValidationTest(`
---
jobs:
- job: some_job
  invalid_parameter: bad value
  invalid_parameter: duplicate key
  another_invalid_parameter: whatever
===
---
jobs:
- job: some_job
  invalid_parameter: bad value
  invalid_parameter: duplicate key
  another_invalid_parameter: whatever
===
`);
        assert.equal(diagnostics.length, 1);
        assert.ok(diagnostics[0].message.indexOf("single-document") >= 0);
    });

    // In truth, these tests should probably all be rewritten to test parser/yamlParser,
    // not services/yamlValidation.
    it('validates pipelines with expressions', async function () {
        const diagnostics = await runValidationTest(`
steps:
- \${{ if succeeded() }}:
  - task: npmAuthenticate@0
    inputs:
      \${{ if ne(variables['Build.Reason'], 'PullRequest') }}:
        workingFile: .npmrc
      \${{ if eq(variables['Build.Reason'], 'PullRequest') }}:
        workingFile: .other_npmrc
`);
        assert.equal(diagnostics.length, 0);
    });

    it('validates pipelines with dynamically-generated variables', async function () {
        const diagnostics = await runValidationTest(`
variables:
  \${{ parameters.environment }}Release: true
`);
        assert.equal(diagnostics.length, 0);
    });

    it('validates pipelines with unfinished conditional variable checks', async function () {
        // Note: the real purpose of this test is to ensure we don't throw,
        // but I can't figure out how to assert that yet.
        // diagnostics.length can be whatever, as long as we get to that point :).
        const diagnostics = await runValidationTest(`
variables:
  \${{ if eq(variables['Build.SourceBranch'], 'main') }}:
`);
        assert.equal(diagnostics.length, 0);
  });

    it('validates pipelines with unfinished conditionally-inserted variables', async function () {
        // Note: the real purpose of this test is to ensure we don't throw,
        // but I can't figure out how to assert that yet.
        // diagnostics.length can be whatever, as long as we get to that point :).
        const diagnostics = await runValidationTest(`
variables:
  \${{ if eq(variables['Build.SourceBranch'], 'main') }}:
    j
`);
        assert.equal(diagnostics.length, 0);
    });

    it('validates pipelines with multiple levels of expression nesting', async function () {
        // Note: the real purpose of this test is to ensure we don't throw,
        // but I can't figure out how to assert that yet.
        // diagnostics.length can be whatever, as long as we get to that point :).
        const diagnostics = await runValidationTest(`
steps:
- \${{ each step in parameters.buildSteps }}:
  - \${{ each pair in step }}:
    \${{ if ne(pair.value, 'CmdLine@2') }}:
      \${{ pair.key }}: \${{ pair.value }}
    \${{ if eq(pair.value, 'CmdLine@2') }}:
      '\${{ pair.value }}': error
`);
        assert.equal(diagnostics.length, 0);
    })
});

const workspaceContext = {
    resolveRelativePath: (relativePath: string, resource: string) => {
        return URL.resolve(resource, relativePath);
    }
};

const requestService = (path: string): Thenable<string> => {
    return new Promise<string>((c, e) => {
        fs.readFile(path, 'UTF-8', (err, result) => {
            err ? e('') : c(result.toString());
        });
    });
};

const schemaResolver = (url: string): Promise<JSONSchema> => {
    return Promise.resolve(JSONSchemaService.ParseSchema(url));
}

// Given a file's content, returns the diagnostics found.
async function runValidationTest(content: string): Promise<Diagnostic[]> {
    const schemaUri: string = "test/pipelinesTests/schema.json";
    const schemaService = new JSONSchemaService.JSONSchemaService(schemaResolver, workspaceContext, requestService);

    const yamlValidation = new YAMLValidation(schemaService, Promise);
    const textDocument: TextDocument = TextDocument.create(schemaUri, "azure-pipelines", 1, content);
    const yamlDoc = yamlparser.parse(content);

    return await yamlValidation.doValidation(textDocument, yamlDoc);
}
