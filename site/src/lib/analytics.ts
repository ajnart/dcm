import { type DcmEvent, onTrack } from "@/lib/track";
import type { CaptureResult, PostHog, Properties } from "posthog-js";
import type { InstallMethodSlug } from "./site";

const PROJECT_KEY = "phc_zY6Yg8ePwEfXC8FadEqkCcoCgzzy2u2VHjpaPTooBDfg";
const PRODUCTION_HOST = "self-host.fyi";
const MAX_PENDING = 50;
const URL_KEY = /(url|referrer|pathname)$/;

export type SiteEvent =
	| { name: "install_command_copied"; method: InstallMethodSlug }
	| { name: "app_install_copied"; app: string }
	| { name: "recipe_install_copied"; recipe: string }
	| { name: "share_link_copied"; count: number };

export type AnalyticsEvent = DcmEvent | SiteEvent;

type Capture = PostHog["capture"];

const pending: AnalyticsEvent[] = [];
let active = false;
let capture: Capture | undefined;

const withoutQuery = (value: string): string => value.split(/[?#]/)[0];

function scrub(properties: Properties | undefined): Properties | undefined {
	if (!properties) return properties;
	const next: Properties = { ...properties };
	for (const key of Object.keys(next)) {
		const value = next[key];
		if (typeof value === "string" && URL_KEY.test(key))
			next[key] = withoutQuery(value);
	}
	return next;
}

function stripUrlDetail(result: CaptureResult): CaptureResult {
	return {
		...result,
		properties: scrub(result.properties) ?? {},
		$set: scrub(result.$set),
		$set_once: scrub(result.$set_once),
	};
}

function deliver(target: Capture, { name, ...properties }: AnalyticsEvent) {
	target(name, properties);
}

function record(event: AnalyticsEvent): void {
	if (capture) {
		deliver(capture, event);
		return;
	}
	if (pending.length < MAX_PENDING) pending.push(event);
}

export function track(event: SiteEvent): void {
	if (!active) return;
	record(event);
}

export function initAnalytics(): void {
	if (active) return;
	if (typeof window === "undefined") return;
	if (window.location.hostname !== PRODUCTION_HOST) return;
	active = true;
	onTrack(record);
	void import("posthog-js").then(({ default: posthog }) => {
		posthog.init(PROJECT_KEY, {
			api_host: "https://hog.ajnart.dev",
			ui_host: "https://eu.posthog.com",
			defaults: "2026-08-30",
			cookieless_mode: "always",
			person_profiles: "never",
			autocapture: false,
			capture_pageview: true,
			capture_pageleave: false,
			capture_dead_clicks: false,
			capture_heatmaps: false,
			capture_exceptions: false,
			capture_performance: false,
			disable_session_recording: true,
			disable_surveys: true,
			disable_product_tours: true,
			disable_conversations: true,
			disable_external_dependency_loading: true,
			advanced_disable_flags: true,
			save_campaign_params: false,
			mask_personal_data_properties: true,
			respect_dnt: true,
			before_send: stripUrlDetail,
		});
		capture = posthog.capture.bind(posthog);
		for (const event of pending.splice(0)) deliver(capture, event);
	});
}
