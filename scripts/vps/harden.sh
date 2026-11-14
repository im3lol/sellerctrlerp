#!/usr/bin/env bash
# Ubuntu 24.04 LTS. Run from a sudo-capable, non-root account over SSH.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo.'; exit 1; }
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || { echo 'Requires Ubuntu 24.04 LTS.'; exit 1; }
: "${ADMIN_CIDR:?set your administration IP/CIDR}"
: "${SSH_PORT:=22}"
[[ $SSH_PORT =~ ^[0-9]+$ && $SSH_PORT -gt 0 && $SSH_PORT -lt 65536 ]] || exit 1
python3 -c 'import ipaddress,sys; n=ipaddress.ip_network(sys.argv[1],strict=False); assert n.prefixlen > 0' "$ADMIN_CIDR"
[[ ${SUDO_USER:-root} != root ]] || { echo 'Use a non-root sudo account; install and test its SSH key first.'; exit 1; }
[[ -s /home/$SUDO_USER/.ssh/authorized_keys ]] || { echo 'No authorized_keys found.'; exit 1; }

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ufw unattended-upgrades
install -d -m 755 /etc/ssh/sshd_config.d
if [[ ${1:-} == --key-login-tested ]]; then
    # Run this second phase from a NEW session opened with public-key-only auth.
    cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.before-sellerctrl
    cat > /etc/ssh/sshd_config.d/00-sellerctrl.conf <<EOF
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
X11Forwarding no
EOF
    /usr/sbin/sshd -t
    effective=$(/usr/sbin/sshd -T -C "user=$SUDO_USER,host=$(hostname),addr=${SSH_CLIENT_IP:?set the administration client IP}")
    for rule in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'permitrootlogin no' 'pubkeyauthentication yes'; do
        grep -qx "$rule" <<< "$effective" || { echo "Conflicting SSH configuration: $rule"; exit 1; }
    done
    systemctl reload ssh
    echo 'SSH hardened. Keep this session open and test another key-only login.'
    exit 0
elif [[ $# != 0 ]]; then
    echo 'Unknown argument'; exit 1
fi

# Deliberately do not reset existing rules. Abort if an existing allow rule could
# keep management exposed; review it explicitly before applying this fresh-VPS policy.
if ufw show added | grep -Eq '^ufw (allow|limit|route)'; then
    echo 'Existing UFW allow rules found. Review/remove them before re-running; no firewall changes applied.'
    exit 1
fi
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$ADMIN_CIDR" to any port "$SSH_PORT" proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52sellerctrl-security <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
EOF
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
echo 'Host policy applied. Keep this session open and verify a second SSH connection.'
