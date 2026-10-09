import { createSurveyHandler } from "./index.js";
import type { ServerOptions } from "./index.js";
import { JevFeatureClient } from "../features/extract.js";
import { createFeaturePipeline, freezeBundle } from "../features/pipeline.js";
import type { FeatureBundle } from "../features/pipeline.js";

/** The host loads a frozen, locally trained bundle. Clients cannot supply feature definitions or weights. */
export function createFeatureSurveyHandler(options: Omit<ServerOptions, "analysis" | "jevModel"> & { bundle: FeatureBundle }): (request: Request) => Promise<Response> {
  const bundle = freezeBundle(options.bundle, options.survey);
  if ([bundle.context, ...Object.values(bundle.questions).map(q => q.model)].some(m => m.source !== "jev")) throw new Error("A live server requires weights trained on Jev features");
  const client = new JevFeatureClient(options.typesafeApiKey ?? "", options.fetcher);
  const analysis = createFeaturePipeline(options.survey, bundle, (manifest, input, signal) => client.extract(manifest, input, signal));
  return createSurveyHandler({ ...options, jevModel: bundle.context.manifest.jevModel, analysis });
}
