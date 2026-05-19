# frozen_string_literal: true
#
# My-Feedbacks DB Bridge — Ruby client (stdlib only).
#
# Mirror of the JS extension client (sidepanel/db-bridge-client.js), the
# Python client (myfb_bridge.py), the Go client (myfb_bridge.go) and the
# Node client (myfb-bridge.mjs). Same HMAC math, same canonical-args
# quirk for PHP compat (empty args serialize to "[]", not "{}"), same
# humanized errors.
#
# Ruby 3.0+. Stdlib only — no Gemfile, no net-http-persistent, no faraday.
#
# Usage :
#
#   require_relative 'myfb_bridge'
#
#   bridge = MyFb::BridgeClient.new(
#     url:    'https://example.com/myfb-bridge.php',
#     secret: ENV.fetch('BRIDGE_SECRET'),
#   )
#
#   meta   = bridge.meta             # → Hash
#   tables = bridge.tables           # → Array<Hash>
#   md     = bridge.schema_md        # → String

require 'json'
require 'net/http'
require 'openssl'
require 'securerandom'
require 'uri'

module MyFb
  MIN_BRIDGE_VERSION = '1.1.0'

  class BridgeError < StandardError; end

  class BridgeClient
    def initialize(url:, secret:, timeout: 10)
      raise BridgeError, 'bridge non configuré (URL et secret requis)' if url.to_s.empty? || secret.to_s.empty?

      @uri     = URI.parse(url)
      @secret  = secret
      @timeout = timeout
    end

    # ── Operations ───────────────────────────────────────────────

    def meta;                            call('meta');                                end
    def tables;                          call('tables').fetch('tables', []);          end
    def describe(table);                 call('describe', { table: table }).fetch('columns', []); end
    def sample(table, limit: 3, strategy: 'mixed')
      call('sample', { table: table, limit: limit, strategy: strategy })
    end
    def count(table);                    call('count', { table: table }).fetch('count', 0).to_i; end
    def schema_md;                       call('schema_md').fetch('markdown', '');     end

    # ── Core ─────────────────────────────────────────────────────

    def call(op, args = {})
      ts    = Time.now.to_i
      nonce = SecureRandom.hex(16)
      body  = { op: op, args: args, ts: ts, nonce: nonce }
      body[:sig] = sign(ts, nonce, op, args)

      req = Net::HTTP::Post.new(@uri)
      req['Content-Type'] = 'application/json'
      req.body            = JSON.generate(body)

      http               = Net::HTTP.new(@uri.host, @uri.port)
      http.use_ssl       = @uri.scheme == 'https'
      http.open_timeout  = @timeout
      http.read_timeout  = @timeout

      begin
        resp = http.request(req)
      rescue StandardError => e
        raise BridgeError, humanize(0, e.message)
      end

      parsed = begin
        JSON.parse(resp.body)
      rescue JSON::ParserError
        raise BridgeError, humanize(resp.code.to_i, 'malformed response')
      end

      version = parsed['version']
      if version && cmp_ver(version, MIN_BRIDGE_VERSION) < 0
        raise BridgeError,
              "Bridge trop ancien (#{version} < #{MIN_BRIDGE_VERSION}) — " \
              'mets à jour myfb-bridge.php'
      end

      raise BridgeError, humanize(resp.code.to_i, parsed['error']) unless parsed['ok']

      parsed['data'] || {}
    end

    private

    # PHP's json_encode($args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE).
    # Empty hash → "[]" (PHP encodes empty assoc as a JSON array).
    def canon_args(args)
      return '[]' if args.nil? || (args.is_a?(Hash) && args.empty?)

      JSON.generate(args)
    end

    def sign(ts, nonce, op, args)
      msg = "#{ts}.#{nonce}.#{op}.#{canon_args(args)}"
      OpenSSL::HMAC.hexdigest('SHA256', @secret, msg)
    end

    def humanize(status, raw)
      r = (raw || '').to_s.downcase
      return 'Bridge inaccessible (réseau / DNS / CORS)'           if status.zero?
      return "Endpoint introuvable — vérifie l'URL du bridge"      if status == 404
      if status == 401
        return 'Nonce déjà utilisé — horloge décalée ?'            if r.include?('replay')
        return 'Horloge client/serveur décalée (> 60s)'            if r.include?('stale')
        return 'Nonce invalide'                                    if r.include?('nonce')

        return 'Signature HMAC invalide — secret incorrect ?'
      end
      return 'Table non exposée par la config du bridge'           if status == 403
      return 'Méthode HTTP refusée — bridge mal configuré'         if status == 405
      return 'Erreur interne du bridge — vérifie audit.log'        if status >= 500

      raw.to_s.empty? ? "Erreur HTTP #{status}" : raw.to_s
    end

    def cmp_ver(a, b)
      pa = (a || '0').split('.').map(&:to_i)
      pb = (b || '0').split('.').map(&:to_i)
      [pa.size, pb.size].max.times do |i|
        va = pa[i] || 0
        vb = pb[i] || 0
        return -1 if va < vb
        return 1  if va > vb
      end
      0
    end
  end
end
