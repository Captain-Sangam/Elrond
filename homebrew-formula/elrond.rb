class Elrond < Formula
  desc "Multi-agent deliberation system — structured AI debates on your Mac"
  homepage "https://github.com/YOUR_USERNAME/elrond"
  url "https://github.com/YOUR_USERNAME/elrond/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "REPLACE_WITH_SHA256_OF_RELEASE_TARBALL"
  license "MIT"

  depends_on "node@18"

  def install
    system "npm", "install", "--production"
    system "npm", "run", "build"

    libexec.install Dir["*"]

    (bin/"elrond").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@18"].opt_bin}/node" "#{libexec}/node_modules/.bin/electron" "#{libexec}/out/main/index.js" "$@"
    EOS
  end

  def caveats
    <<~EOS
      Elrond requires API keys for at least two of: OpenAI, Anthropic, Google.
      On first launch, a setup wizard will guide you through key configuration.
      Keys are stored securely in your macOS Keychain.
    EOS
  end

  test do
    assert_match "Elrond", shell_output("#{bin}/elrond --version 2>&1", 1)
  end
end
