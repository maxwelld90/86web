#include <stdio.h>
#include <unistd.h>
#include <sys/prctl.h>
#include <sys/capability.h>

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "Usage: cap_wrap PROGRAM [ARGS...]\n");
        return 1;
    }
    /* Raise CAP_NET_RAW  — needed by libpcap (pcap_findalldevs / raw sockets)
       Raise CAP_NET_ADMIN — needed to open/create TAP devices via /dev/net/tun */
    cap_t cap = cap_get_proc();
    if (cap) {
        cap_value_t vals[] = { CAP_NET_RAW, CAP_NET_ADMIN };
        cap_set_flag(cap, CAP_INHERITABLE, 2, vals, CAP_SET);
        cap_set_proc(cap);
        cap_free(cap);
    }
    prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_RAISE, CAP_NET_RAW,   0, 0);
    prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_RAISE, CAP_NET_ADMIN, 0, 0);
    execvp(argv[1], argv + 1);
    perror("cap_wrap: exec failed");
    return 1;
}
