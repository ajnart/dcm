import { legacyModeTarget } from "@/lib/modes";

const target = legacyModeTarget(new URL(window.location.href));

if (target) {
	const next = new URL(target, window.location.href);
	if (next.pathname === window.location.pathname) {
		window.history.replaceState(window.history.state, "", next);
	} else {
		window.location.replace(next);
	}
}
