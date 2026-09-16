#!/bin/sh
set -e

ALPINE_BRANCH="v3.20"
ALPINE_VER="3.20.0"
ARCH="aarch64"
WORK_DIR="/tmp/guest-build"
OUT_DIR="$(pwd)/../assets/guest"

mkdir -p "${WORK_DIR}" "${OUT_DIR}"
cd "${WORK_DIR}"

echo "[1/4] Downloading Alpine Linux ARM64 minirootfs..."
wget -q -c "http://dl-cdn.alpinelinux.org/alpine/${ALPINE_BRANCH}/releases/${ARCH}/alpine-minirootfs-${ALPINE_VER}-${ARCH}.tar.gz"

echo "[2/4] Extracting rootfs..."
rm -rf rootfs
mkdir -p rootfs
tar -xzf "alpine-minirootfs-${ALPINE_VER}-${ARCH}.tar.gz" -C rootfs/

echo "[3/4] Creating bulletproof /init startup script..."
cat << 'EOF' > rootfs/init
#!/bin/sh
# Mount pseudo-filesystems
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts

# Configure SLiRP networking & DNS
ifconfig lo 127.0.0.1 up
udhcpc -i eth0 -q 2>/dev/null || true
echo "nameserver 10.0.2.3" > /etc/resolv.conf

# Setup HTTP repositories to bypass missing SSL certificates on initial boot
cat << 'REPO' > /etc/apk/repositories
http://dl-cdn.alpinelinux.org/alpine/v3.20/main
http://dl-cdn.alpinelinux.org/alpine/v3.20/community
REPO

# Mount shared iOS host workspace directory via 9p VirtFS
mkdir -p /root/workspace
mount -t 9p -o trans=virtio,version=9p2000.L,msize=512000 host_workspace /root/workspace 2>/dev/null || true

export HOME=/root
export TERM=vt100
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /root

echo ""
echo "=== Alpine Linux ARM64 (iOS VM) ==="
echo "Workspace mounted at /root/workspace"
echo ""
exec /bin/sh
EOF

chmod +x rootfs/init

echo "[4/4] Packing initramfs and fetching kernel..."
# Compatible with both BusyBox cpio and GNU cpio (-H newc -o)
cd rootfs
find . | cpio -H newc -o | gzip -9 > "${OUT_DIR}/initramfs-virt.cpio.gz"
cd ..

# Fetch official headless virt kernel
wget -q -c "http://dl-cdn.alpinelinux.org/alpine/${ALPINE_BRANCH}/releases/${ARCH}/netboot/vmlinuz-virt" -O "${OUT_DIR}/vmlinuz-virt"

# Clean up
rm -rf "${WORK_DIR}"

echo "SUCCESS: Assets generated at assets/guest/"
ls -lh "${OUT_DIR}"