import { trainAndSaveModel, modelStatus, evaluateModel } from './ml.mjs';
const model = trainAndSaveModel();
console.log(JSON.stringify({ version: model.version, rows: model.trainingRows, status: modelStatus(), evaluation: evaluateModel() }, null, 2));
