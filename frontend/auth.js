/**
 * Auth0 SPA + guest client id for KlearNow Tariff.
 * Surfaces: local | playground | external | engine
 */
import { createAuth0Client } from "@auth0/auth0-spa-js";

const params = new URLSearchParams(location.search);
const embed =
  params.get("embed") === "1" ||
  params.get("surface") === "external" ||
  document.documentElement.dataset.surface === "external";

export const SURFACE =
  params.get("surface") ||
  (embed ? "external" : (import.meta.env.VITE_SURFACE || "local"));

const CLIENT_KEY = "kn_tariff_client_id";

export function clientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

let auth0 = null;
let accessToken = null;
let cfg = null;

export async function loadConfig() {
  const res = await fetch("/v1/config");
  cfg = await res.json();
  return cfg;
}

export function getConfig() {
  return cfg;
}

export async function initAuth() {
  if (!cfg) await loadConfig();
  const domain = import.meta.env.VITE_AUTH0_DOMAIN || cfg?.auth0_domain;
  const clientIdEnv = import.meta.env.VITE_AUTH0_CLIENT_ID;
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE || cfg?.auth0_audience;
  if (!domain || !clientIdEnv) return null;

  auth0 = await createAuth0Client({
    domain,
    clientId: clientIdEnv,
    authorizationParams: {
      redirect_uri: window.location.origin + window.location.pathname,
      audience: audience || undefined,
    },
    cacheLocation: "localstorage",
  });

  if (params.has("code") && params.has("state")) {
    await auth0.handleRedirectCallback();
    const clean = new URL(location.href);
    clean.searchParams.delete("code");
    clean.searchParams.delete("state");
    history.replaceState({}, document.title, clean.pathname + clean.search);
  }

  if (await auth0.isAuthenticated()) {
    accessToken = await auth0.getTokenSilently();
  }
  return auth0;
}

export async function login() {
  if (!auth0) throw new Error("Auth0 is not configured");
  await auth0.loginWithRedirect();
}

export async function logout() {
  if (!auth0) return;
  accessToken = null;
  await auth0.logout({ logoutParams: { returnTo: window.location.origin } });
}

export async function isAuthenticated() {
  return Boolean(auth0 && (await auth0.isAuthenticated()));
}

export function getAccessToken() {
  return accessToken;
}

export async function refreshToken() {
  if (!auth0 || !(await auth0.isAuthenticated())) {
    accessToken = null;
    return null;
  }
  accessToken = await auth0.getTokenSilently();
  return accessToken;
}

/** API key for local / playground. Role demo switcher may override. */
export function apiKeyFromQuery() {
  const params = new URLSearchParams(location.search);
  if (SURFACE === "external") return params.get("key") || "";
  const demo = localStorage.getItem("kn_tariff_demo_role");
  if (demo === "guest") return "";
  if (demo === "user") return "dev-calculate";
  if (demo === "admin") return "dev-internal";
  return params.get("key") || import.meta.env.VITE_API_KEY || "dev-internal";
}

export function setDemoRole(role) {
  if (!role) localStorage.removeItem("kn_tariff_demo_role");
  else localStorage.setItem("kn_tariff_demo_role", role);
}

export function getDemoRole() {
  return localStorage.getItem("kn_tariff_demo_role") || "admin";
}

export function isEmbed() {
  return embed || SURFACE === "external";
}
