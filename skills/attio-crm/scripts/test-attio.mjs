import { attioRequest } from './lib/attio-client.mjs';

try {
  const data = await attioRequest('/v2/objects');
  const objects = data?.data || [];
  console.log(JSON.stringify({
    ok: true,
    objectCount: objects.length,
    objects: objects.map(o => ({
      id: o.id?.object_id || o.id,
      apiSlug: o.api_slug,
      singular: o.singular_noun,
      plural: o.plural_noun,
    })),
  }, null, 2));
} catch (err) {
  console.log(JSON.stringify({
    ok: false,
    status: err.status || null,
    error: err.body || String(err.message || err),
  }, null, 2));
  process.exit(1);
}
