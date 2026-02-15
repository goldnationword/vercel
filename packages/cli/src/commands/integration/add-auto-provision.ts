import chalk from 'chalk';
import open from 'open';
import output from '../../output-manager';
import type Client from '../../util/client';
import getScope from '../../util/get-scope';
import { autoProvisionResource } from '../../util/integration/auto-provision-resource';
import { fetchIntegrationWithTelemetry } from '../../util/integration/fetch-integration';
import { selectProduct } from '../../util/integration/select-product';
import type {
  AcceptedPolicies,
  AutoProvisionedResponse,
  AutoProvisionResult,
} from '../../util/integration/types';
import { resolveResourceName } from '../../util/integration/generate-resource-name';
import {
  getLinkedProjectField,
  postProvisionSetup,
  type PostProvisionOptions,
} from '../../util/integration/post-provision-setup';
import {
  IntegrationAddTelemetryClient,
  type MarketplaceEventProperties,
} from '../../util/telemetry/commands/integration/add';
import {
  parseMetadataFlags,
  validateAndPrintRequiredMetadata,
} from '../../util/integration/parse-metadata';
import type { Metadata } from '../../util/integration/types';

export interface AddAutoProvisionOptions extends PostProvisionOptions {
  metadata?: string[];
  productSlug?: string;
  billingPlanId?: string;
}

export async function addAutoProvision(
  client: Client,
  integrationSlug: string,
  resourceNameArg?: string,
  options: AddAutoProvisionOptions = {}
) {
  const telemetry = new IntegrationAddTelemetryClient({
    opts: {
      store: client.telemetryEventStore,
    },
  });
  telemetry.trackCliOptionName(resourceNameArg);
  telemetry.trackCliOptionMetadata(options.metadata);
  telemetry.trackCliFlagNoConnect(options.noConnect);
  telemetry.trackCliFlagNoEnvPull(options.noEnvPull);
  telemetry.trackCliOptionPlan(options.billingPlanId);

  // 1. Get team context
  const { contextName, team } = await getScope(client);
  if (!team) {
    output.error('Team not found');
    return 1;
  }

  // 2. Fetch integration
  const integration = await fetchIntegrationWithTelemetry(
    client,
    integrationSlug,
    telemetry
  );
  if (!integration) {
    return 1;
  }

  if (!integration.products?.length) {
    output.error(
      `Integration "${integrationSlug}" is not a Marketplace integration`
    );
    return 1;
  }

  // 3. Select product (by slug, single auto-select, or interactive prompt in TTY)
  if (
    !options.productSlug &&
    integration.products.length > 1 &&
    !client.stdin.isTTY
  ) {
    const choices = integration.products
      .map(p => `  ${integrationSlug}/${p.slug}`)
      .join('\n');
    output.error(
      `Integration "${integrationSlug}" has multiple products. Specify one with:\n\n${choices}\n\nExample: vercel integration add ${integrationSlug}/${integration.products[0].slug}`
    );
    return 1;
  }

  const product = await selectProduct(
    client,
    integration.products,
    options.productSlug
  );
  if (!product) {
    return 1;
  }

  const marketplaceProps: MarketplaceEventProperties = {
    integration_id: integration.id,
    integration_slug: integration.slug,
    integration_name: integration.name,
    product_id: product.id,
    product_slug: product.slug,
    team_slug: team.slug,
    is_from_cli: true,
    is_cli_auto_provision: true,
  };

  telemetry.trackInstallFlowStarted(marketplaceProps);

  output.log(
    `Installing ${chalk.bold(product.name)} by ${chalk.bold(integration.name)} under ${chalk.bold(contextName)}`
  );
  output.debug(`Selected product: ${product.slug} (id: ${product.id})`);
  output.debug(
    `Product metadataSchema: ${JSON.stringify(product.metadataSchema, null, 2)}`
  );

  // 4. Validate metadata flags (if provided) BEFORE prompting for resource name
  let metadata: Metadata;
  if (options.metadata?.length) {
    // Parse metadata from CLI flags
    output.debug(
      `Parsing metadata from flags: ${JSON.stringify(options.metadata)}`
    );
    const { metadata: parsed, errors } = parseMetadataFlags(
      options.metadata,
      product.metadataSchema
    );
    if (errors.length) {
      for (const error of errors) {
        output.error(error);
      }
      return 1;
    }
    // Validate all required fields are present
    if (!validateAndPrintRequiredMetadata(parsed, product.metadataSchema)) {
      return 1;
    }
    metadata = parsed;
  } else {
    // No --metadata flags: pass {} and let server fill defaults (API PR #58905)
    metadata = {};
  }

  // 5. Resolve and validate resource name
  const nameResult = resolveResourceName(product.slug, resourceNameArg);
  if ('error' in nameResult) {
    output.error(nameResult.error);
    return 1;
  }
  const { resourceName } = nameResult;

  output.debug(`Collected metadata: ${JSON.stringify(metadata)}`);
  output.debug(`Resource name: ${resourceName}`);

  // 6. Track plan selection (server decides plan in auto-provision unless --plan flag)
  telemetry.trackCheckoutPlanSelected({
    ...marketplaceProps,
    billing_plan_id: options.billingPlanId,
    plan_selection_method: options.billingPlanId ? 'cli_flag' : 'server_default',
  });

  // 7. First attempt with empty policies - discover what's required
  telemetry.trackCheckoutProvisioningStarted(marketplaceProps);
  output.spinner('Provisioning resource...');
  let result: AutoProvisionResult;
  let attemptedPolicyRetry = false;
  try {
    result = await autoProvisionResource(
      client,
      integration.slug,
      product.slug,
      resourceName,
      metadata,
      {}, // Start with empty policies
      options.billingPlanId
    );
  } catch (error) {
    output.stopSpinner();
    telemetry.trackCheckoutProvisioningFailed({
      ...marketplaceProps,
      error_message: (error as Error).message,
    });
    output.error((error as Error).message);
    return 1;
  }
  output.stopSpinner();
  output.debug(`Auto-provision result: ${JSON.stringify(result, null, 2)}`);

  // 7. If policies required, prompt and retry
  if (result.kind === 'install') {
    output.debug(`Policy acceptance required`);
    const policies = result.integration.policies ?? {};
    output.debug(`Policies to accept: ${JSON.stringify(policies)}`);
    const acceptedPolicies: AcceptedPolicies = {};

    if (policies.privacy) {
      const accepted = await client.input.confirm(
        `Accept privacy policy? (${policies.privacy})`,
        false
      );
      if (!accepted) {
        output.error('Privacy policy must be accepted to continue.');
        return 1;
      }
      acceptedPolicies.privacy = new Date().toISOString();
    }

    if (policies.eula) {
      const accepted = await client.input.confirm(
        `Accept terms of service? (${policies.eula})`,
        false
      );
      if (!accepted) {
        output.error('Terms of service must be accepted to continue.');
        return 1;
      }
      acceptedPolicies.eula = new Date().toISOString();
    }

    // Retry with accepted policies
    attemptedPolicyRetry = true;
    output.debug(`Accepted policies: ${JSON.stringify(acceptedPolicies)}`);
    output.spinner('Provisioning resource...');
    try {
      result = await autoProvisionResource(
        client,
        integration.slug,
        product.slug,
        resourceName,
        metadata,
        acceptedPolicies,
        options.billingPlanId
      );
    } catch (error) {
      output.stopSpinner();
      telemetry.trackCheckoutProvisioningFailed({
        ...marketplaceProps,
        error_message: (error as Error).message,
      });
      output.error((error as Error).message);
      return 1;
    }
    output.stopSpinner();
    output.debug(
      `Auto-provision retry result: ${JSON.stringify(result, null, 2)}`
    );
  }

  // 8. Handle non-provisioned responses (metadata, unknown)
  if (result.kind !== 'provisioned') {
    telemetry.trackInstallFlowWebFallback({
      ...marketplaceProps,
      reason:
        result.kind === 'metadata'
          ? 'metadata_required'
          : result.kind === 'install'
            ? 'policy_acceptance'
            : result.reason ?? 'server_fallback',
      auto_provision_result_kind: result.kind,
      auto_provision_result_reason: result.reason,
      auto_provision_error_message: result.error_message,
      attempted_policy_retry: attemptedPolicyRetry,
    });
    output.debug(`Fallback required - kind: ${result.kind}`);
    output.debug(`Fallback URL from API: ${result.url}`);

    // Auto-detect project for browser URL
    const projectLink = await getLinkedProjectField(
      client,
      options.noConnect,
      'name'
    );
    if (projectLink.exitCode !== undefined) {
      return projectLink.exitCode;
    }

    output.log('Additional setup required. Opening browser...');
    const url = new URL(result.url);
    url.searchParams.set('defaultResourceName', resourceName);
    url.searchParams.set('source', 'cli');
    if (Object.keys(metadata).length > 0) {
      url.searchParams.set('metadata', JSON.stringify(metadata));
    }
    if (projectLink.value) {
      url.searchParams.set('projectSlug', projectLink.value);
    }
    if (options.billingPlanId) {
      url.searchParams.set('planId', options.billingPlanId);
    }
    output.debug(`Opening URL: ${url.href}`);
    open(url.href);
    return 0;
  }

  // 9. Success! (TypeScript needs explicit narrowing here because `result` is
  //    reassigned in the policy-retry branch above, which prevents control-flow narrowing.)
  const provisioned = result as AutoProvisionedResponse;
  telemetry.trackCheckoutProvisioningCompleted({
    ...marketplaceProps,
    resource_id: provisioned.resource.id,
    resource_name: resourceName,
  });
  output.debug(
    `Provisioned resource: ${JSON.stringify(provisioned.resource, null, 2)}`
  );
  output.debug(
    `Installation: ${JSON.stringify(provisioned.installation, null, 2)}`
  );
  output.debug(
    `Billing plan: ${JSON.stringify(provisioned.billingPlan, null, 2)}`
  );
  output.success(
    `${product.name} successfully provisioned: ${chalk.bold(resourceName)}`
  );

  // 10. Post-provision: dashboard URL, connect, env pull
  return postProvisionSetup(
    client,
    resourceName,
    provisioned.resource.id,
    contextName,
    {
      ...options,
      onProjectConnected: (projectId: string) => {
        telemetry.trackProjectConnected({
          ...marketplaceProps,
          project_id: projectId,
          resource_id: provisioned.resource.id,
        });
      },
    }
  );
}
