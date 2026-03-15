FROM ubuntu:22.04

LABEL maintainer="86Web"
LABEL description="86Web Runner — 86Box process manager with Xvfb + x11vnc + PulseAudio + ffmpeg"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    wget \
    tigervnc-standalone-server \
    x11-utils \
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libxrandr2 \
    libxi6 \
    libxtst6 \
    libxrender1 \
    libxfixes3 \
    libxcursor1 \
    libxcomposite1 \
    libxdamage1 \
    libxkbcommon0 \
    libxkbcommon-x11-0 \
    libdbus-1-3 \
    libasound2 \
    libpulse0 \
    libopenal1 \
    libevdev2 \
    libfreetype6 \
    libwayland-client0 \
    libwayland-cursor0 \
    libwayland-egl1 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-render-util0 \
    libxcb-xinerama0 \
    libxcb-randr0 \
    libxcb-shape0 \
    libxcb-xkb1 \
    pulseaudio \
    pulseaudio-utils \
    jq \
    gosu \
    matchbox-window-manager \
    ffmpeg \
    xdotool \
    iproute2 \
    sudo \
    libpcap0.8 \
    libcap2-bin \
    && rm -rf /var/lib/apt/lists/*

# Build cap_wrap: raises CAP_NET_RAW as an ambient capability so that 86Box
# (extracted from its AppImage via exec) inherits NET_RAW without needing root.
# File capabilities on cap_wrap (cap_net_raw,cap_setpcap+ep) grant it the
# effective caps it needs; it then raises CAP_NET_RAW into the inheritable+ambient
# sets before exec'ing 86Box, so pcap sockets work on TAP interfaces.
COPY cap_wrap.c /tmp/cap_wrap.c
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev libcap-dev \
    && gcc -O2 -o /usr/local/bin/cap_wrap /tmp/cap_wrap.c -lcap \
    && setcap 'cap_net_raw,cap_net_admin,cap_setpcap+ep' /usr/local/bin/cap_wrap \
    && rm /tmp/cap_wrap.c \
    && apt-get purge -y gcc libc6-dev libcap-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
